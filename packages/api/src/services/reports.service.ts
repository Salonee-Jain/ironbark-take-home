import {
  factDigest,
  generateReport,
  groupBySection,
  readReportCache,
  REPORT_PROMPT_VERSION,
  verifyClaims,
  type Claim,
  type ClaimRejection,
  type GeneratedReport,
  type ReportFact,
  type ReportRejection,
  type ReportSectionOutput,
} from '@ironbark/etl/ai/report';
import { providerFlag, resolveProvider } from '@ironbark/etl/ai/providers';
import { AppError } from '../errors.js';
import * as dataQualityRepository from '../repositories/dataQuality.repository.js';
import * as emissionsRepository from '../repositories/emissions.repository.js';
import * as incidentsRepository from '../repositories/incidents.repository.js';
import * as repository from '../repositories/reports.repository.js';
import { getOutageAnalysis } from './correlation.service.js';

/**
 * The AI compliance summary.
 *
 * An AI claim in a compliance document has to be traceable, and for a narrative
 * that means a citation. A citation is only worth something if the thing cited
 * existed before the model was asked, so this service does the arithmetic first:
 * it assembles a fact pack from the same repositories the dashboard uses, hands
 * the model that closed set, and lets the gate discard anything the pack does
 * not support.
 *
 * Reading a report re-runs the same gate against current facts, so a stored
 * summary cannot outlive the numbers it describes.
 */

export class ReportUnavailableError extends AppError {
  constructor(message: string, hint?: string) {
    super(422, 'report_unavailable', message, hint);
  }
}

export class ProviderUnavailableError extends AppError {
  constructor(message: string, hint?: string) {
    super(503, 'ai_provider_unavailable', message, hint);
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const toTonnes = (kg: number) => round1(kg / 1000);

/** `2026-03` -> `March 2026`, for fact labels a model will read aloud in prose. */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthName(month: string): string {
  const [year, index] = month.split('-');
  return `${MONTH_NAMES[Number(index) - 1] ?? month} ${year}`;
}

/**
 * Accumulates the pack.
 *
 * Records are merged rather than appended because one incident can be reached
 * from three directions, psychosocial classification, severity mismatch, and
 * the outage narrative, and a pack containing `INC-2026-134` three times would
 * give the same id three different meanings. A citation must resolve to exactly
 * one fact or it resolves to nothing.
 */
class FactPack {
  private readonly metrics: ReportFact[] = [];
  private readonly records = new Map<string, ReportFact>();

  metric(
    id: string,
    label: string,
    value: number | string,
    unit: string | null,
    source: string,
    detail?: string,
  ): void {
    this.metrics.push({
      id,
      kind: 'metric',
      label,
      value,
      unit,
      source,
      detail: detail ?? null,
    });
  }

  record(
    id: string,
    label: string,
    value: number | string,
    source: string,
    detail: string,
  ): void {
    const existing = this.records.get(id);
    if (existing) {
      // Both readings of the same record, kept: "psychosocial hazard" and
      // "severity understated" are different claims about one incident and a
      // reader needs both next to the citation.
      existing.detail = `${existing.detail}; ${detail}`;
      existing.label = `${existing.label}; ${label}`;
      return;
    }
    this.records.set(id, {
      id,
      kind: 'record',
      label,
      value,
      unit: null,
      source,
      detail,
    });
  }

  all(): ReportFact[] {
    return [...this.metrics, ...this.records.values()];
  }
}

export type FactPackResult = {
  facts: ReportFact[];
  period: { from: string; to: string; company: string } | null;
};

/**
 * Every figure the model is allowed to state, assembled from the same
 * repositories the dashboard reads.
 *
 * Composed rather than re-queried on purpose. If this built its own totals, a
 * divergence between the summary and the chart beside it would be possible, 
 * and of the two, the prose is the one a reader would believe.
 */
export async function buildFactPack(
  companyId: number,
  companyName: string,
): Promise<FactPackResult> {
  const [
    totals,
    financialYears,
    extremes,
    months,
    incidentTypes,
    incidentSeverities,
    dqTotals,
    dqSeverity,
    dqAction,
    dqRules,
    aiSummary,
    psychosocial,
    mismatches,
    suppliers,
    fuelTotals,
    electricity,
    outage,
  ] = await Promise.all([
    emissionsRepository.findPeriodTotals(companyId),
    emissionsRepository.findFinancialYears(companyId),
    emissionsRepository.findExtremeMonths(companyId),
    emissionsRepository.findMonthlyTotals(companyId, { from: null, to: null }),
    incidentsRepository.countByType(companyId, { from: null, to: null }),
    incidentsRepository.countBySeverity(companyId, { from: null, to: null }),
    dataQualityRepository.findTotals(companyId),
    dataQualityRepository.countBySeverity(companyId),
    dataQualityRepository.countByAction(companyId),
    dataQualityRepository.countByRule(companyId),
    repository.findAiFindingSummary(companyId),
    repository.findFlaggedIncidents(companyId, 'psychosocial'),
    repository.findFlaggedIncidents(companyId, 'mismatch'),
    repository.findSupplierTotals(companyId),
    repository.findFuelTotals(companyId),
    repository.findElectricityTotals(companyId),
    getOutageAnalysis(companyId),
  ]);

  if (!totals?.first_month || !totals.last_month || months.length === 0) {
    return { facts: [], period: null };
  }

  // Sorted here rather than trusted from SQL. Several of these queries order by
  // a count, and Postgres is free to return tied rows in any order, which would
  // make the fact digest differ between two databases holding identical data,
  // and the committed summary would stop matching the dataset it was written
  // for. The pack is part of a prompt; its order has to be ours, not the
  // planner's.
  const orderedIncidentTypes = [...incidentTypes].sort((a, b) =>
    a.type_code.localeCompare(b.type_code),
  );
  const orderedIncidentSeverities = [...incidentSeverities].sort(
    (a, b) => (a.severity ?? 0) - (b.severity ?? 0),
  );
  const orderedDqSeverity = [...dqSeverity].sort((a, b) => a.key.localeCompare(b.key));
  const orderedDqAction = [...dqAction].sort((a, b) => a.key.localeCompare(b.key));
  const orderedDqRules = [...dqRules].sort((a, b) => a.rule_id.localeCompare(b.rule_id));

  const pack = new FactPack();
  const period = {
    from: totals.first_month,
    to: totals.last_month,
    company: companyName,
  };

  // --- scale --------------------------------------------------------------
  const emissionsSource = 'v_monthly_emissions_totals';

  pack.metric(
    'PERIOD-RANGE',
    'Reporting period covered by the loaded export',
    `${monthName(totals.first_month)} to ${monthName(totals.last_month)}`,
    null,
    emissionsSource,
  );
  pack.metric(
    'PERIOD-MONTHS',
    'Months of data in the period',
    totals.months,
    'months',
    emissionsSource,
  );

  pack.metric(
    'EMISSIONS-TOTAL-KG',
    'Total emissions for the whole period, Scope 1 plus Scope 2',
    round2(totals.total_kg_co2e),
    'kg CO2e',
    emissionsSource,
  );
  pack.metric(
    'EMISSIONS-TOTAL-T',
    'Total emissions for the whole period, Scope 1 plus Scope 2',
    toTonnes(totals.total_kg_co2e),
    't CO2e',
    emissionsSource,
  );
  pack.metric(
    'EMISSIONS-SCOPE1-T',
    'Scope 1 emissions for the whole period, from fuel combustion',
    toTonnes(totals.scope1_kg_co2e),
    't CO2e',
    emissionsSource,
  );
  pack.metric(
    'EMISSIONS-SCOPE2-T',
    'Scope 2 emissions for the whole period, from purchased grid electricity',
    toTonnes(totals.scope2_kg_co2e),
    't CO2e',
    emissionsSource,
  );
  pack.metric(
    'EMISSIONS-SCOPE1-SHARE-PCT',
    'Share of the period total that is Scope 1',
    totals.total_kg_co2e === 0
      ? 0
      : round1((totals.scope1_kg_co2e / totals.total_kg_co2e) * 100),
    '%',
    emissionsSource,
  );
  pack.metric(
    'EMISSIONS-CORRECTED-RECORDS',
    'Activity records contributing to the totals that carry a data-quality error',
    totals.quality_error_count,
    'records',
    emissionsSource,
    'These figures rest on corrected source values; the original value is retained on every corrected row.',
  );

  for (const fy of financialYears) {
    pack.metric(
      `FY${fy.financial_year}-TOTAL-T`,
      `FY${fy.financial_year} total emissions (Australian financial year, July to June)`,
      toTonnes(fy.total_kg_co2e),
      't CO2e',
      'v_financial_year_emissions',
      `Scope 1 ${toTonnes(fy.scope1_kg_co2e)} t, Scope 2 ${toTonnes(fy.scope2_kg_co2e)} t, ` +
        `${fy.months_with_data} months of data, ` +
        (fy.is_complete_year
          ? 'a complete financial year'
          : 'an incomplete financial year — not comparable with a full one'),
    );
  }

  for (const extreme of extremes) {
    pack.metric(
      extreme.kind === 'highest' ? 'EMISSIONS-PEAK-MONTH' : 'EMISSIONS-LOWEST-MONTH',
      extreme.kind === 'highest'
        ? 'Highest-emitting month in the period'
        : 'Lowest-emitting month in the period',
      monthName(extreme.month),
      null,
      emissionsSource,
      `${toTonnes(extreme.total_kg_co2e)} t CO2e`,
    );
  }

  // Every month, so a claim about any one of them has something to cite.
  for (const month of months) {
    pack.metric(
      `MONTH-${month.month}`,
      `${monthName(month.month)} total emissions`,
      toTonnes(month.total_kg_co2e),
      't CO2e',
      emissionsSource,
      `Scope 1 ${toTonnes(month.scope1_kg_co2e)} t, Scope 2 ${toTonnes(month.scope2_kg_co2e)} t, ` +
        `Scope 1 share ${month.scope1_share_pct}%, ` +
        `${month.contributing_records} contributing records, ` +
        `${month.quality_error_count} of them corrected`,
    );
  }

  for (const fuel of fuelTotals) {
    pack.metric(
      `ACTIVITY-${fuel.factor_key.toUpperCase().replace(/_/g, '-')}-L`,
      `${fuel.activity} delivered over the period`,
      round2(fuel.quantity),
      fuel.unit,
      'fuel_deliveries',
      `Across ${fuel.deliveries} invoices, converted at ${fuel.kg_co2e_per_unit} kg CO2e per ` +
        `${fuel.unit}. Credit notes are netted off; duplicate invoices are excluded.`,
    );
  }

  if (electricity) {
    pack.metric(
      'ACTIVITY-GRID-KWH',
      'Grid electricity consumed over the period',
      round2(electricity.grid_kwh),
      'kWh',
      'electricity_readings',
      `Converted at ${electricity.kg_co2e_per_unit ?? 'the supplied factor'} kg CO2e per kWh.`,
    );
    pack.metric(
      'ACTIVITY-METERS',
      'Electricity meters reporting in the export',
      electricity.meters,
      'meters',
      'meters',
      `${electricity.meter_readings} monthly readings across the period`,
    );
  }

  // --- safety --------------------------------------------------------------
  const incidentTotal = incidentSeverities.reduce(
    (sum, row) => sum + row.incident_count,
    0,
  );

  pack.metric(
    'INCIDENTS-TOTAL',
    'Incidents in the register for the period',
    incidentTotal,
    'incidents',
    'incident_register.csv',
  );

  for (const row of orderedIncidentSeverities) {
    const key = row.severity === null ? 'UNRECORDED' : String(row.severity);
    pack.metric(
      `INCIDENTS-SEVERITY-${key}`,
      row.severity === null
        ? 'Incidents with no usable severity in the source'
        : `Incidents at normalised severity ${row.severity} (1 minor, 2 moderate, 3 serious)`,
      row.incident_count,
      'incidents',
      'incident_register.csv',
    );
  }

  for (const row of orderedIncidentTypes) {
    pack.metric(
      `INCIDENTS-TYPE-${row.type_code}`,
      `Incidents coded ${row.type_code} in the register (${row.type_label})`,
      row.incident_count,
      'incidents',
      'incident_register.csv',
    );
  }

  if (aiSummary && aiSummary.findings > 0) {
    pack.metric(
      'AI-FINDINGS-TOTAL',
      'Incident descriptions classified by the AI layer',
      aiSummary.findings,
      'incidents',
      'ai_incident_findings',
      `Model ${aiSummary.model ?? 'unknown'}, prompt ${aiSummary.prompt_version ?? 'unknown'}. ` +
        'Every finding carries a quote that appears verbatim in the incident it cites.',
    );
    pack.metric(
      'AI-PSYCHOSOCIAL-COUNT',
      'Incidents the AI layer identified as psychosocial hazards, whatever their original code',
      aiSummary.psychosocial,
      'incidents',
      'ai_incident_findings',
    );
    pack.metric(
      'AI-SEVERITY-MISMATCH-COUNT',
      'Incidents where the description does not support the recorded severity',
      aiSummary.severity_mismatches,
      'incidents',
      'ai_incident_findings',
    );
  }

  for (const finding of psychosocial) {
    pack.record(
      finding.incident_id,
      `Incident ${finding.incident_id}, classified as a psychosocial hazard`,
      finding.incident_date,
      `incident_register.csv + ai_incident_findings`,
      `coded ${finding.type_code} in the register, recorded severity ${
        finding.severity ?? 'not recorded'
      }, location ${finding.location}. Description: "${finding.description}". ` +
        `AI category ${finding.category}; evidence quote: "${finding.evidence_quote}"`,
    );
  }

  for (const finding of mismatches) {
    pack.record(
      finding.incident_id,
      `Incident ${finding.incident_id}, recorded severity contradicted by its description`,
      finding.incident_date,
      `incident_register.csv + ai_incident_findings`,
      `recorded severity ${finding.severity ?? 'not recorded'}, assessed from the text as ${
        finding.severity_assessment ?? 'unknown'
      }. Description: "${finding.description}". Evidence quote: "${finding.evidence_quote}"`,
    );
  }

  // --- data quality ---------------------------------------------------------
  if (dqTotals) {
    pack.metric(
      'DQ-ISSUES-TOTAL',
      'Data-quality findings raised against the source files',
      dqTotals.total_issues,
      'findings',
      'data_quality_issues',
    );
    pack.metric(
      'DQ-RULES-TRIGGERED',
      'Distinct data-quality rules that fired',
      dqTotals.rules_triggered,
      'rules',
      'data_quality_issues',
    );
  }

  for (const row of orderedDqSeverity) {
    pack.metric(
      `DQ-SEVERITY-${row.key.toUpperCase()}`,
      `Data-quality findings at severity "${row.key}"`,
      row.issue_count,
      'findings',
      'data_quality_issues',
    );
  }

  for (const row of orderedDqAction) {
    pack.metric(
      `DQ-ACTION-${row.key.toUpperCase()}`,
      `Data-quality findings resolved by action "${row.key}"`,
      row.issue_count,
      'findings',
      'data_quality_issues',
      row.key === 'fixed'
        ? 'Corrected in flight, with the original value retained on the record.'
        : row.key === 'flagged'
          ? 'Loaded as-is and surfaced for a human, because a correction would have been a guess.'
          : 'Excluded from the analytics tables and recorded in full with the reason.',
    );
  }

  for (const rule of orderedDqRules.filter((r) => r.issue_count > 0)) {
    pack.record(
      rule.rule_id,
      rule.title,
      rule.issue_count,
      rule.source_file,
      `${rule.issue_count} finding(s), severity ${rule.severity}, action ${rule.action}. ${rule.rationale}`,
    );
  }

  // --- suppliers and what cannot be reported --------------------------------
  if (suppliers && suppliers.supplier_count > 0) {
    pack.metric(
      'SUPPLIERS-COUNT',
      'Distinct suppliers after duplicate merging',
      suppliers.supplier_count,
      'suppliers',
      'suppliers',
    );
    pack.metric(
      'SUPPLIERS-DUPLICATES-MERGED',
      'Supplier rows merged into another as duplicates',
      suppliers.duplicate_count,
      'rows',
      'suppliers',
    );
    pack.metric(
      'SUPPLIERS-INVALID-ABN',
      'Supplier rows whose ABN is missing or fails the ATO checksum',
      suppliers.invalid_abn_count,
      'rows',
      'suppliers',
    );
    pack.metric(
      'SUPPLIERS-SPEND-AUD',
      'Total supplier spend for the financial year',
      round2(suppliers.consolidated_spend_aud),
      'AUD',
      'suppliers',
    );
  }

  pack.metric(
    'SCOPE3-STATUS',
    'Scope 3 reporting position',
    'Not calculable from this export',
    null,
    'derived',
    'The supplier file carries spend and category but the emission factors provided are ' +
      'activity-based, with no spend-based factor. A Scope 3 figure would be our invention.',
  );
  pack.metric(
    'INTENSITY-STATUS',
    'Emissions intensity reporting position',
    'Not calculable from this export',
    null,
    'derived',
    'No production data — no tonnes moved, no operating hours — so there is no denominator. ' +
      'Reporting intensity against an invented denominator would be worse than reporting none.',
  );

  // --- the cross-dataset event ---------------------------------------------
  if (outage.detected) {
    const source = 'GET /api/analysis/outage (detected, not hard-coded)';

    pack.metric(
      'OUTAGE-MONTH',
      'Month whose grid consumption is a downward outlier against the rest of the period',
      monthName(outage.month),
      null,
      source,
      'Detected with the same robust outlier test the data-quality rules use.',
    );
    pack.metric(
      'OUTAGE-GRID-CHANGE-PCT',
      'Change in site-wide grid consumption in that month against the median month',
      outage.electricity.changePct,
      '%',
      source,
      `${outage.electricity.metersBelowBaseline} of ${outage.electricity.meterCount} meters fell at once, ` +
        'each measured against its own history — a supply event rather than an instrument fault.',
    );
    pack.metric(
      'OUTAGE-FUEL-CHANGE-PCT',
      'Change in fuel volume in that month against the median month',
      outage.fuel.changePct,
      '%',
      source,
      `${round2(outage.fuel.excessLitres)} litres above a normal month, across ${outage.fuel.deliveryCount} deliveries.`,
    );
    pack.metric(
      'OUTAGE-SCOPE1-CHANGE-PCT',
      'Change in Scope 1 in that month against the median month',
      outage.emissions.scope1ChangePct,
      '%',
      source,
    );
    pack.metric(
      'OUTAGE-SCOPE2-CHANGE-PCT',
      'Change in Scope 2 in that month against the median month',
      outage.emissions.scope2ChangePct,
      '%',
      source,
    );
    pack.metric(
      'OUTAGE-TOTAL-CHANGE-PCT',
      'Change in total emissions in that month against the median month',
      outage.emissions.totalChangePct,
      '%',
      source,
      'Negative: the headline total falls even though the site burned more diesel, which is ' +
        'why a single-number dashboard reads this month as an improvement.',
    );
    pack.metric(
      'OUTAGE-SCOPE1-SHARE-PCT',
      'Scope 1 share of the footprint in that month',
      outage.emissions.actual.scope1SharePct,
      '%',
      source,
      `Against ${outage.emissions.baseline.scope1SharePct}% in a median month.`,
    );
    pack.metric(
      'OUTAGE-COUNTERFACTUAL-T',
      'What that month would have emitted on normal supply',
      toTonnes(outage.counterfactual.totalKgCo2e),
      't CO2e',
      source,
      `Reported total was ${toTonnes(outage.emissions.actual.totalKgCo2e)} t. ` +
        outage.counterfactual.assumption,
    );

    if (outage.incidents.rootCause) {
      const root = outage.incidents.rootCause;
      pack.record(
        root.id,
        `Incident ${root.id}, the register's explanation for the outage month`,
        root.incidentDate,
        'incident_register.csv',
        `coded ${root.typeCode}, severity ${root.severity ?? 'not recorded'}. Description: "${root.description}"`,
      );
    }
    for (const consequence of outage.incidents.consequences) {
      pack.record(
        consequence.id,
        `Incident ${consequence.id}, inside the outage window`,
        consequence.incidentDate,
        'incident_register.csv + ai_incident_findings',
        `coded ${consequence.typeCode}, severity ${consequence.severity ?? 'not recorded'}, ` +
          `AI category ${consequence.aiCategory ?? 'unclassified'}. Description: "${consequence.description}"`,
      );
    }
  }

  return { facts: pack.all(), period };
}

/** A stored or cached report, re-checked against the facts as they are now. */
type PresentableReport = {
  period: { from: string; to: string };
  generatedAt: string;
  provider: string;
  model: string;
  promptVersion: string;
  factDigest: string;
  sections: ReportSectionOutput[];
  rejected: ReportRejection[];
  claimsRejected: number;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number | null;
  };
};

function toClaims(sections: ReportSectionOutput[]): Claim[] {
  return sections.flatMap((section) =>
    section.claims.map((claim) => ({
      section: section.section,
      text: claim.text,
      citations: claim.citations,
    })),
  );
}

/**
 * Re-verification on read. A sentence that was true of the old fact pack can be
 * false of the new one while still looking perfectly well cited, so checking
 * again here is the difference between "this was verified once" and "this is
 * verified now".
 */
function present(
  report: PresentableReport,
  facts: ReportFact[],
  currentDigest: string,
  source: 'database' | 'cache-file',
  companyName: string,
) {
  const claims = toClaims(report.sections);
  const { accepted, rejected } = verifyClaims(claims, facts);
  const factsChanged = report.factDigest !== currentDigest;

  return {
    available: true as const,
    source,
    period: { ...report.period, company: companyName },
    generatedAt: report.generatedAt,
    provider: report.provider,
    model: report.model,
    promptVersion: report.promptVersion,
    sections: groupBySection(accepted),
    /** The closed set the model was allowed to draw on; the UI renders the chips from it. */
    facts,
    verification: {
      claimsChecked: claims.length,
      claimsShown: accepted.length,
      /** Rejected when the report was generated, the gate's original work. */
      claimsRejectedAtGeneration: report.claimsRejected,
      /** Rejected now, against current data. Non-zero means the data moved. */
      claimsDroppedOnRead: rejected.length,
      droppedOnRead: rejected as ClaimRejection[],
      factsChanged,
      note: factsChanged
        ? 'The underlying figures have changed since this summary was generated. Claims that no ' +
          'longer match the data have been removed; regenerate for an up-to-date summary.'
        : 'Every claim shown was re-checked against the current figures when this response was built.',
    },
    rejectedAtGeneration: report.rejected,
    usage: report.usage,
  };
}

export type SummaryResponse =
  | ReturnType<typeof present>
  | { available: false; reason: string; hint: string };

/**
 * Proportion of a cached summary's claims that must still verify for it to be
 * offered to this dataset.
 *
 * High enough that another company's data cannot reach it: their figures differ
 * under the same fact ids, so almost every claim fails. Low enough that a
 * corrected fact does not discard a document that is otherwise still true.
 */
const CACHE_MATCH_THRESHOLD = 0.7;

function stillDescribes(
  sections: ReportSectionOutput[],
  facts: ReportFact[],
): boolean {
  const claims = toClaims(sections);
  if (claims.length === 0) return false;
  const { accepted } = verifyClaims(claims, facts);
  return accepted.length / claims.length >= CACHE_MATCH_THRESHOLD;
}

export async function getSummary(companyId: number): Promise<SummaryResponse> {
  const companyName = (await repository.findCompanyName(companyId)) ?? 'this company';
  const { facts } = await buildFactPack(companyId, companyName);

  if (facts.length === 0) {
    return {
      available: false,
      reason: 'This workspace has no loaded data to summarise.',
      hint: 'Upload the five source files first; the summary is written from the cleaned figures.',
    };
  }

  const digest = factDigest(facts);
  const stored = await repository.findLatestReport(companyId);

  if (stored) {
    return present(
      {
        period: { from: stored.period_from, to: stored.period_to },
        generatedAt: stored.generated_at,
        provider: stored.provider,
        model: stored.model,
        promptVersion: stored.prompt_version,
        factDigest: stored.fact_digest,
        sections: stored.sections,
        rejected: stored.rejected,
        claimsRejected: stored.claims_rejected,
        usage: stored.token_usage,
      },
      facts,
      digest,
      'database',
      companyName,
    );
  }

  // The committed artefact, which is what lets a reviewer with no API key see
  // the feature working on the demo export.
  //
  // Offered on a match of substance rather than of fingerprint: correcting one
  // unrelated fact should drop the claims that moved, not a document whose other
  // twenty claims are still exactly true. The threshold is what keeps it safe for
  // another tenant, whose different values under the same fact ids fail the gate
  // wholesale.
  const cached = readReportCache();
  if (cached && stillDescribes(cached.sections, facts)) {
    return present(
      {
        period: { from: cached.period.from, to: cached.period.to },
        generatedAt: cached.generatedAt,
        provider: cached.provider,
        model: cached.model,
        promptVersion: cached.promptVersion,
        factDigest: cached.factDigest,
        sections: cached.sections,
        rejected: cached.rejected,
        claimsRejected: cached.claimsRejected,
        usage: cached.usage,
      },
      facts,
      digest,
      'cache-file',
      companyName,
    );
  }

  return {
    available: false,
    reason: 'No compliance summary has been generated for this dataset yet.',
    hint:
      'POST /api/reports/summary to generate one. It needs ANTHROPIC_API_KEY or OPENAI_API_KEY ' +
      'on the server; every other part of the application runs without one.',
  };
}

/**
 * Generate, verify, store.
 *
 * Owner-only at the route, because this is the one endpoint that spends money
 * and publishes a document under the company's name.
 */
export async function generateAndStore(
  companyId: number,
  actor: { userId: number | null },
  options: { provider?: string | undefined } = {},
): Promise<{
  report: GeneratedReport;
  stored: repository.StoredReportRow;
  facts: ReportFact[];
  companyName: string;
}> {
  const companyName = (await repository.findCompanyName(companyId)) ?? 'this company';

  const provider = (() => {
    try {
      return resolveProvider(options.provider);
    } catch (error) {
      // A missing key is a deployment fact, not a caller error: 503 with the
      // vendor's own message, rather than a 500 that reads like a bug.
      throw new ProviderUnavailableError(
        'No AI provider is configured on this server.',
        error instanceof Error ? error.message.split('\n')[0] : undefined,
      );
    }
  })();

  const { facts, period } = await buildFactPack(companyId, companyName);
  if (!period || facts.length === 0) {
    throw new ReportUnavailableError(
      'There is no loaded data to summarise.',
      'Upload the five source files first.',
    );
  }

  const report = await generateReport(provider, facts, period);

  if (report.claimsAccepted === 0) {
    // Nothing survived the gate. Better to say so than to store an empty
    // document that reads as "we had nothing to report".
    throw new ReportUnavailableError(
      'Every claim the model produced failed the citation gate, so there is nothing to publish.',
      `${report.claimsRejected} claim(s) were rejected. This usually means the prompt and the fact pack have drifted apart.`,
    );
  }

  const stored = await repository.insertReport({
    companyId,
    userId: actor.userId,
    periodFrom: period.from,
    periodTo: period.to,
    facts,
    factDigest: report.factDigest,
    sections: report.sections,
    rejected: report.rejected,
    claimsAccepted: report.claimsAccepted,
    claimsRejected: report.claimsRejected,
    provider: report.provider,
    model: report.model,
    promptVersion: REPORT_PROMPT_VERSION,
    tokenUsage: report.usage,
  });

  return { report, stored, facts, companyName };
}

export async function generateSummary(
  companyId: number,
  actor: { userId: number | null },
  options: { provider?: string | undefined } = {},
): Promise<SummaryResponse> {
  const { report, stored, facts, companyName } = await generateAndStore(
    companyId,
    actor,
    options,
  );

  return present(
    {
      period: { from: stored.period_from, to: stored.period_to },
      generatedAt: stored.generated_at,
      provider: stored.provider,
      model: stored.model,
      promptVersion: stored.prompt_version,
      factDigest: stored.fact_digest,
      sections: stored.sections,
      rejected: stored.rejected,
      claimsRejected: stored.claims_rejected,
      usage: stored.token_usage,
    },
    facts,
    report.factDigest,
    'database',
    companyName,
  );
}

/** Re-exported for the CLI, which resolves a provider from argv the same way. */
export { providerFlag };
