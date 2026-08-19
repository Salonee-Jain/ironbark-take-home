import type { CsvFile } from '../csv.js';
import type { IssueCollector } from '../issues.js';
import { normaliseDate } from '../normalise/index.js';
import { isOutlier, median, modifiedZScore } from '../stats.js';

export type MeterRecord = {
  meterId: string;
  description: string;
};

export type ElectricityReadingRecord = {
  meterId: string;
  period: string;
  consumptionKwh: number;
  originalConsumption: number;
  originalUnit: string;
  unitCorrectionFactor: number;
  sourceRowNumber: number;
};

/**
 * How many orders of magnitude below a meter's own maximum a reading has to sit
 * before it is treated as a unit error rather than a quiet month.
 *
 * 2.5 leaves a wide margin either side of the real cases. The MTR-07 readings
 * are ~3 orders of magnitude down (kWh recorded as MWh). The March 2026 outage
 * — the thing this must NOT touch — is 0.5 orders down. There is nothing in
 * between, so the threshold is not finely balanced.
 */
const UNIT_ERROR_MAGNITUDE_GAP = 2.5;

/** Assumed cause of a ~1000x level shift: readings taken in MWh, labelled kWh. */
const MWH_TO_KWH = 1000;

/** A corrected reading must land within this factor of the meter's norm. */
const CORRECTION_SANITY_RANGE = { low: 0.2, high: 5 };


export function loadElectricityReadings(
  file: CsvFile,
  issues: IssueCollector,
): { meters: MeterRecord[]; readings: ElectricityReadingRecord[] } {

  type StagedReading = {
    meterId: string;
    description: string;
    period: string;
    value: number;
    unit: string;
    sourceRowNumber: number;
  };

  const staged: StagedReading[] = [];
  const meters = new Map<string, string>();

  for (const row of file.rows) {
    const meterId = row.value('meter_id').trim();
    const description = row.value('meter_description').trim();
    const rawPeriod = row.value('period').trim();
    const rawConsumption = row.value('consumption').trim();
    const unit = row.value('unit').trim();

    // Periods are `2025-01`; reuse the date normaliser by anchoring to a day.
    const period = normaliseDate(`${rawPeriod}-01`);
    const value = Number(rawConsumption);

    if (!period.ok || !Number.isFinite(value)) {
      issues.add({
        ruleId: 'ELEC-UNIT-SCALE-01',
        severity: 'error',
        action: 'rejected',
        sourceRowNumber: row.lineNumber,
        recordKey: meterId,
        description: `Reading could not be parsed (period "${rawPeriod}", consumption "${rawConsumption}"). Row excluded.`,
        originalValue: `${rawPeriod} ${rawConsumption}`,
      });
      continue;
    }

    meters.set(meterId, description);
    staged.push({
      meterId,
      description,
      period: period.value.iso,
      value,
      unit,
      sourceRowNumber: row.lineNumber,
    });
  }

  // --- meter numbering gap --------------------------------------------------
  // A missing meter cannot be detected from the rows that are present, only
  // from the shape of the identifiers, so this looks for holes in the sequence.
  const meterNumbers = [...meters.keys()]
    .map((id) => /^MTR-(\d+)$/.exec(id))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));

  if (meterNumbers.length > 0) {
    const lowest = Math.min(...meterNumbers);
    const highest = Math.max(...meterNumbers);
    const present = new Set(meterNumbers);
    const missing = [];
    for (let n = lowest; n <= highest; n++) {
      if (!present.has(n)) missing.push(`MTR-${String(n).padStart(2, '0')}`);
    }

    if (missing.length > 0) {
      issues.add({
        ruleId: 'ELEC-METER-GAP-01',
        recordKey: missing.join(', '),
        field: 'meter_id',
        description:
          `Meters run MTR-${String(lowest).padStart(2, '0')} to MTR-${String(highest).padStart(2, '0')}, ` +
          `but ${missing.join(', ')} never appears in ${new Set(staged.map((s) => s.period)).size} months of readings. ` +
          'Either decommissioned before the period, or a load that is not being reported. ' +
          'The difference matters: one is fine, the other means Scope 2 is understated by an unknown amount.',
        originalValue: `${meters.size} meters present`,
      });
    }
  }

  // --- unit scale errors, per meter ----------------------------------------
  const readings: ElectricityReadingRecord[] = [];

  for (const [meterId] of meters) {
    const meterRows = staged.filter((s) => s.meterId === meterId);
    const positive = meterRows.filter((s) => s.value > 0);
    if (positive.length === 0) continue;

    const maxLog = Math.max(...positive.map((s) => Math.log10(s.value)));
    const suspect = positive.filter(
      (s) => Math.log10(s.value) <= maxLog - UNIT_ERROR_MAGNITUDE_GAP,
    );
    const normal = meterRows.filter((s) => !suspect.includes(s));
    const reference = median(normal.map((s) => s.value));

    for (const staging of meterRows) {
      let consumption = staging.value;
      let factor = 1;

      if (suspect.includes(staging) && reference > 0) {
        const corrected = staging.value * MWH_TO_KWH;
        const plausible =
          corrected >= reference * CORRECTION_SANITY_RANGE.low &&
          corrected <= reference * CORRECTION_SANITY_RANGE.high;

        if (plausible) {
          consumption = corrected;
          factor = MWH_TO_KWH;
          issues.add({
            ruleId: 'ELEC-UNIT-SCALE-01',
            sourceRowNumber: staging.sourceRowNumber,
            recordKey: `${meterId} ${staging.period.slice(0, 7)}`,
            field: 'consumption',
            description:
              `Reading of ${staging.value} ${staging.unit} is ~1000x below this meter's own norm of ` +
              `${Math.round(reference).toLocaleString()} kWh. Consistent with a reading taken in MWh and ` +
              `labelled kWh. Corrected x${MWH_TO_KWH}.`,
            originalValue: `${staging.value} ${staging.unit}`,
            resolvedValue: `${corrected} kWh`,
          });
        } else {
          // The magnitude is off but x1000 does not reconcile it. Correcting
          // anyway would be inventing a number to fit a theory.
          issues.add({
            ruleId: 'ELEC-UNIT-SCALE-01',
            action: 'flagged',
            sourceRowNumber: staging.sourceRowNumber,
            recordKey: `${meterId} ${staging.period.slice(0, 7)}`,
            field: 'consumption',
            description:
              `Reading of ${staging.value} ${staging.unit} is far below this meter's norm of ` +
              `${Math.round(reference).toLocaleString()} kWh, but a x${MWH_TO_KWH} correction does not reconcile it either. ` +
              'Loaded unchanged and flagged for the client.',
            originalValue: `${staging.value} ${staging.unit}`,
          });
        }
      }

      readings.push({
        meterId,
        period: staging.period,
        consumptionKwh: Math.round(consumption * 100) / 100,
        originalConsumption: staging.value,
        originalUnit: staging.unit,
        unitCorrectionFactor: factor,
        sourceRowNumber: staging.sourceRowNumber,
      });
    }
  }

  // --- site-wide consumption anomaly ---------------------------------------
  // Deliberately runs on corrected values: before correction MTR-07 would drag
  // every month from October onward downward and mask the real event.
  const totalByMonth = new Map<string, number>();
  for (const reading of readings) {
    totalByMonth.set(
      reading.period,
      (totalByMonth.get(reading.period) ?? 0) + reading.consumptionKwh,
    );
  }

  const monthlyTotals = [...totalByMonth.values()];
  const medianMonth = median(monthlyTotals);

  for (const [period, total] of [...totalByMonth].sort()) {
    if (total < medianMonth && isOutlier(total, monthlyTotals)) {
      issues.add({
        ruleId: 'ELEC-CONSUMPTION-DROP-01',
        recordKey: period.slice(0, 7),
        field: 'consumption',
        description:
          `${period.slice(0, 7)} draws ${Math.round(total).toLocaleString()} kWh site-wide, ` +
          `${Math.round((total / medianMonth) * 100)}% of the median month ` +
          `(${Math.round(medianMonth).toLocaleString()} kWh, modified z-score ${modifiedZScore(total, monthlyTotals).toFixed(1)}), across every meter at once. ` +
          'A simultaneous fall on all meters points at supply, not metering. Left uncorrected — see the incident register for this month.',
        originalValue: `${Math.round(total)} kWh`,
      });
    }
  }

  return {
    meters: [...meters].map(([meterId, description]) => ({
      meterId,
      description,
    })),
    readings,
  };
}
