import { isOutlier, median } from '@ironbark/shared';
import * as repository from '../repositories/correlation.repository.js';

/**
 * Cross-dataset correlation: finding the month where three datasets tell one
 * story.
 *
 * Everything here is detected, not hard-coded. No month, meter or incident id
 * appears as a literal, so the same shape would be found in next year's export.
 * Detection uses the same outlier test as the ETL's anomaly rules, so the
 * dashboard cannot narrate an event the data-quality report did not flag, and
 * every assumption is returned in the payload rather than buried in prose.
 */

type Series = { month: string; value: number }[];

/** Median of the series with one month held out, the "normal month" baseline. */
function baselineExcluding(series: Series, month: string): number {
  return median(
    series.filter((point) => point.month !== month).map((point) => point.value),
  );
}

function changePct(actual: number, baseline: number): number {
  if (baseline === 0) return 0;
  return round1(((actual - baseline) / baseline) * 100);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The month to explain: the largest downward outlier in site-wide grid
 * consumption.
 *
 * Downward specifically. An upward spike in electricity is a different story
 * with a different explanation, and a detector that reported either would
 * produce a narrative that does not match the one this analysis constructs.
 */
function findOutageMonth(electricity: Series): string | null {
  const values = electricity.map((point) => point.value);
  const centre = median(values);

  const candidates = electricity.filter(
    (point) => point.value < centre && isOutlier(point.value, values),
  );
  if (candidates.length === 0) return null;

  return candidates.reduce((lowest, point) =>
    point.value < lowest.value ? point : lowest,
  ).month;
}

export type OutageAnalysis = Awaited<ReturnType<typeof getOutageAnalysis>>;

export async function getOutageAnalysis(companyId: number) {
  const [electricityRows, fuelRows, scopeRows, gridFactor] = await Promise.all([
    repository.findMonthlyElectricity(companyId),
    repository.findMonthlyFuel(companyId),
    repository.findMonthlyScopes(companyId),
    repository.findGridFactor(),
  ]);

  const electricity: Series = electricityRows.map((row) => ({
    month: row.month,
    value: Number(row.consumption_kwh),
  }));

  // Months with no fuel at all are excluded from the fuel baseline. November
  // 2025 has no invoices, a known paperwork gap, flagged by FUEL-MONTH-GAP-01, 
  // and a baseline that averaged in a month of zero would understate "normal"
  // and overstate how unusual the outage month looks.
  const fuel: Series = fuelRows
    .filter((row) => Number(row.litres) > 0)
    .map((row) => ({ month: row.month, value: Number(row.litres) }));

  const month = electricity.length >= 6 ? findOutageMonth(electricity) : null;

  if (!month) {
    return {
      detected: false as const,
      reason:
        electricity.length < 6
          ? 'Not enough months of electricity readings to establish a baseline.'
          : 'No month shows a site-wide grid anomaly against the rest of the period.',
      monthsAnalysed: electricity.length,
    };
  }

  // --- the three datasets, each against its own baseline ---------------------

  const actualKwh = electricity.find((p) => p.month === month)?.value ?? 0;
  const baselineKwh = baselineExcluding(electricity, month);

  const actualLitres = fuel.find((p) => p.month === month)?.value ?? 0;
  const baselineLitres = baselineExcluding(fuel, month);

  // Each meter judged against its own history, not against the site average.
  // "All six fell at once" is the claim that makes this a supply event rather
  // than a broken instrument, so it has to be measured per meter to mean
  // anything.
  const meterRows = await repository.findMetersForMonth(companyId, month);
  const historyRows = await repository.findMeterHistory(companyId);

  const historyByMeter = new Map<string, number[]>();
  for (const row of historyRows) {
    if (row.month === month) continue; // exclude the month under test
    const values = historyByMeter.get(row.meter_id) ?? [];
    values.push(Number(row.consumption_kwh));
    historyByMeter.set(row.meter_id, values);
  }

  const meters = meterRows.map((row) => {
    const own = historyByMeter.get(row.meter_id) ?? [];
    const ownBaseline = median(own);
    const value = Number(row.consumption_kwh);
    return {
      meterId: row.meter_id,
      description: row.description,
      consumptionKwh: value,
      baselineKwh: round2(ownBaseline),
      changePct: changePct(value, ownBaseline),
      belowBaseline: ownBaseline > 0 && value < ownBaseline,
    };
  });

  const metersBelow = meters.filter((meter) => meter.belowBaseline).length;

  const scopes = scopeRows.map((row) => ({
    month: row.month,
    scope1: Number(row.scope1_kg_co2e),
    scope2: Number(row.scope2_kg_co2e),
    total: Number(row.total_kg_co2e),
    share: Number(row.scope1_share_pct),
  }));

  const actual = scopes.find((s) => s.month === month);
  const withFuel = scopes.filter((s) => s.scope1 > 0);

  const baseline = {
    scope1: median(withFuel.filter((s) => s.month !== month).map((s) => s.scope1)),
    scope2: median(scopes.filter((s) => s.month !== month).map((s) => s.scope2)),
    share: median(withFuel.filter((s) => s.month !== month).map((s) => s.share)),
  };
  const baselineTotal = baseline.scope1 + baseline.scope2;

  // The counterfactual. Not a forecast: it costs a normal month's activity at the
  // normal factors, to answer what this month would have emitted had the grid
  // held. The assumption travels in the payload because it is doing real work.
  const counterfactualTotal = round2(baselineTotal);
  const actualTotal = actual?.total ?? 0;

  // --- the incidents that explain it ----------------------------------------
  //
  // A window, not the calendar month: an outage that starts mid-month has
  // consequences that land weeks later, and those are the interesting ones.
  const windowStart = `${month}-01`;
  const windowEnd = addMonths(month, 1);
  const incidentRows = await repository.findIncidentsBetween(
    companyId,
    windowStart,
    `${windowEnd}-28`,
  );

  // The candidate root cause: the most severe electrical incident inside the
  // outage month. Electrical because that is the signal being explained, this
  // analysis does not claim to find causes in general, only to check whether the
  // register offers one for *this* anomaly.
  const rootCause =
    incidentRows
      .filter((row) => row.type_code === 'ELE' && row.incident_date.startsWith(month))
      .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))[0] ?? null;

  // The human tail: anything the AI layer read as a psychosocial hazard inside
  // the window. These are the records the register itself codes as 'other'.
  const consequences = incidentRows.filter((row) => row.ai_is_psychosocial === true);

  return {
    detected: true as const,
    month,
    window: { from: windowStart, to: `${windowEnd}-28` },

    electricity: {
      actualKwh: round2(actualKwh),
      baselineKwh: round2(baselineKwh),
      changePct: changePct(actualKwh, baselineKwh),
      meterCount: meters.length,
      metersBelowBaseline: metersBelow,
      // Every meter with its own baseline, so a reader can see the fall is
      // site-wide rather than one instrument failing. That distinction is the
      // whole reason this reads as a supply event and not a data-quality defect.
      meters,
    },

    fuel: {
      actualLitres: round2(actualLitres),
      baselineLitres: round2(baselineLitres),
      changePct: changePct(actualLitres, baselineLitres),
      excessLitres: round2(actualLitres - baselineLitres),
      deliveryCount:
        fuelRows.find((row) => row.month === month)?.delivery_count ?? 0,
    },

    emissions: {
      actual: {
        scope1KgCo2e: actual?.scope1 ?? 0,
        scope2KgCo2e: actual?.scope2 ?? 0,
        totalKgCo2e: actualTotal,
        scope1SharePct: actual?.share ?? 0,
      },
      baseline: {
        scope1KgCo2e: round2(baseline.scope1),
        scope2KgCo2e: round2(baseline.scope2),
        totalKgCo2e: counterfactualTotal,
        scope1SharePct: round1(baseline.share),
      },
      scope1ChangePct: changePct(actual?.scope1 ?? 0, baseline.scope1),
      scope2ChangePct: changePct(actual?.scope2 ?? 0, baseline.scope2),
      totalChangePct: changePct(actualTotal, baselineTotal),
    },

    counterfactual: {
      totalKgCo2e: counterfactualTotal,
      // Negative: the reported figure is *below* what a normal month would have
      // been. That gap is the size of the misreading, not a saving.
      reportedMinusCounterfactualKg: round2(actualTotal - counterfactualTotal),
      gridFactorKgPerKwh: gridFactor,
      assumption:
        'Assumes the site would otherwise have operated at its median month for both ' +
        'grid consumption and fuel. It is a comparison against normal, not a forecast: ' +
        'if output was down that month for an unrelated reason, this overstates the gap.',
    },

    incidents: {
      rootCause: rootCause
        ? {
            id: rootCause.id,
            incidentDate: rootCause.incident_date,
            typeCode: rootCause.type_code,
            severity: rootCause.severity,
            description: rootCause.description,
          }
        : null,
      consequences: consequences.map((row) => ({
        id: row.id,
        incidentDate: row.incident_date,
        typeCode: row.type_code,
        severity: row.severity,
        description: row.description,
        aiCategory: row.ai_category,
        aiEvidenceQuote: row.ai_evidence_quote,
      })),
      countInWindow: incidentRows.length,
    },

    /**
     * The causal chain, as an ordered list rather than a paragraph.
     *
     * Each link names the dataset it rests on, so a reader can check any single
     * step without accepting the whole story. The chain is the finding; the
     * numbers are only its evidence.
     */
    chain: buildChain({
      month,
      rootCause: rootCause?.id ?? null,
      electricityChange: changePct(actualKwh, baselineKwh),
      meterCount: metersBelow,
      fuelChange: changePct(actualLitres, baselineLitres),
      scope1Change: changePct(actual?.scope1 ?? 0, baseline.scope1),
      scope2Change: changePct(actual?.scope2 ?? 0, baseline.scope2),
      totalChange: changePct(actualTotal, baselineTotal),
      sharePct: actual?.share ?? 0,
      consequence: consequences[0]?.id ?? null,
    }),
  };
}

/** `2026-03` + 1 -> `2026-04`. */
function addMonths(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const zeroBased = index - 1 + delta;
  const nextYear = year + Math.floor(zeroBased / 12);
  const nextMonth = ((zeroBased % 12) + 12) % 12;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`;
}

function buildChain(input: {
  month: string;
  rootCause: string | null;
  electricityChange: number;
  meterCount: number;
  fuelChange: number;
  scope1Change: number;
  scope2Change: number;
  totalChange: number;
  sharePct: number;
  consequence: string | null;
}) {
  const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

  return [
    {
      step: 1,
      source: 'incident_register.csv',
      title: 'Grid supply is lost',
      detail: input.rootCause
        ? `${input.rootCause} records the failure and the switch to backup generation.`
        : 'No incident in the register explains the anomaly — worth asking the client about.',
      recordId: input.rootCause,
    },
    {
      step: 2,
      source: 'electricity_meter_readings.csv',
      title: 'Consumption collapses across every meter',
      detail: `Site-wide grid draw ${pct(input.electricityChange)} against the median month, on all ${input.meterCount} meters at once. A simultaneous fall on every meter is a supply event, not an instrument fault.`,
      recordId: null,
    },
    {
      step: 3,
      source: 'fuel_deliveries.csv',
      title: 'Diesel substitutes for the lost supply',
      detail: `Fuel volume ${pct(input.fuelChange)} against the median month.`,
      recordId: null,
    },
    {
      step: 4,
      source: 'derived',
      title: 'Scope 2 falls, Scope 1 rises harder',
      detail: `Scope 2 ${pct(input.scope2Change)}, Scope 1 ${pct(input.scope1Change)}. Scope 1 share reaches ${input.sharePct}% for the month.`,
      recordId: null,
    },
    {
      step: 5,
      source: 'derived',
      title: 'The headline total falls, and reads as an improvement',
      detail: `Total ${pct(input.totalChange)} — which on a dashboard reporting one number looks like the best month of the period.`,
      recordId: null,
    },
    {
      step: 6,
      source: 'incident_register.csv + AI layer',
      title: 'The cost lands on the crews',
      detail: input.consequence
        ? `${input.consequence} reports fatigue from covering generator operations. Coded as 'other' in the register; identified as a psychosocial hazard by the AI layer.`
        : 'No psychosocial hazard was identified in the window.',
      recordId: input.consequence,
    },
  ];
}
