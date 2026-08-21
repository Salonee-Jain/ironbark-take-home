import { getPool } from '@ironbark/db';
import type { ReportFact, ReportRejection, ReportSectionOutput } from '@ironbark/etl/ai/report';

/**
 * Data access for the cited compliance summary.
 *
 * Two jobs, and only the second is unusual. The first is the handful of
 * aggregates the fact pack needs that no other endpoint already asks for —
 * everything else is composed in the service from the existing emissions,
 * incident and data-quality repositories rather than re-queried here, because a
 * summary that computed its own totals could disagree with the dashboard beside
 * it, and a compliance document that contradicts the screen it sits on is worse
 * than no document.
 *
 * The second is storing the report itself: prose, the fact pack it was written
 * from, and what the citation gate refused.
 *
 * **Tenancy**, as everywhere: `companyId` is `$1` of every statement.
 */

export type AiFindingSummaryRow = {
  findings: number;
  psychosocial: number;
  severity_mismatches: number;
  model: string | null;
  prompt_version: string | null;
};

export type AiFindingRecordRow = {
  incident_id: string;
  incident_date: string;
  type_code: string;
  location: string;
  severity: number | null;
  description: string;
  category: string;
  severity_assessment: number | null;
  confidence: number | null;
  evidence_quote: string;
};

export type SupplierTotalsRow = {
  supplier_count: number;
  duplicate_count: number;
  invalid_abn_count: number;
  consolidated_spend_aud: number;
};

export type FuelTotalsRow = {
  factor_key: string;
  activity: string;
  unit: string;
  kg_co2e_per_unit: number;
  quantity: number;
  deliveries: number;
};

export type ElectricityTotalsRow = {
  grid_kwh: number;
  kg_co2e_per_unit: number | null;
  meter_readings: number;
  meters: number;
};

export type StoredReportRow = {
  id: number;
  period_from: string;
  period_to: string;
  facts: ReportFact[];
  fact_digest: string;
  sections: ReportSectionOutput[];
  rejected: ReportRejection[];
  claims_accepted: number;
  claims_rejected: number;
  provider: string;
  model: string;
  prompt_version: string;
  token_usage: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number | null;
  };
  generated_at: string;
};

/** Slug to id, for the CLI — the API itself never takes a company from a caller. */
export async function findCompanyIdBySlug(
  slug: string,
): Promise<{ id: number; name: string } | undefined> {
  const { rows } = await getPool().query<{ id: number; name: string }>(
    'select id, name from companies where slug = $1',
    [slug],
  );
  return rows[0];
}

/** The company's display name, for the prompt and the report header. */
export async function findCompanyName(
  companyId: number,
): Promise<string | undefined> {
  const { rows } = await getPool().query<{ name: string }>(
    'select name from companies where id = $1',
    [companyId],
  );
  return rows[0]?.name;
}

export async function findAiFindingSummary(
  companyId: number,
): Promise<AiFindingSummaryRow | undefined> {
  const { rows } = await getPool().query<AiFindingSummaryRow>(
    `select
       count(*)::int                                        as findings,
       count(*) filter (where is_psychosocial)::int         as psychosocial,
       count(*) filter (where severity_mismatch)::int       as severity_mismatches,
       -- One model and prompt version per load in practice; max() picks a single
       -- value without asking the caller to reduce a list, and a mixed table
       -- would be a bug worth seeing rather than a shape worth supporting.
       max(model)                                           as model,
       max(prompt_version)                                  as prompt_version
     from ai_incident_findings
     where company_id = $1`,
    [companyId],
  );
  return rows[0];
}

/**
 * The incidents the AI layer flagged, with the evidence each flag rests on.
 *
 * These become `record` facts, so a claim about psychosocial hazards can cite
 * the incidents it is about rather than only the count. The quote travels with
 * them: it is what makes a claim about an incident checkable in one glance
 * against the register.
 */
export async function findFlaggedIncidents(
  companyId: number,
  kind: 'psychosocial' | 'mismatch',
): Promise<AiFindingRecordRow[]> {
  const predicate =
    kind === 'psychosocial' ? 'f.is_psychosocial' : 'f.severity_mismatch';

  const { rows } = await getPool().query<AiFindingRecordRow>(
    `select
       i.id                                   as incident_id,
       to_char(i.incident_date, 'YYYY-MM-DD') as incident_date,
       i.type_code,
       i.location_raw                         as location,
       i.severity,
       i.description,
       f.category,
       f.severity_assessment,
       f.confidence,
       f.evidence_quote
     from ai_incident_findings f
     join incidents i
       on i.id = f.incident_id
      and i.company_id = f.company_id
     where f.company_id = $1
       and ${predicate}
     order by i.incident_date, i.id`,
    [companyId],
  );
  return rows;
}

export async function findSupplierTotals(
  companyId: number,
): Promise<SupplierTotalsRow | undefined> {
  const { rows } = await getPool().query<SupplierTotalsRow>(
    `select
       count(*) filter (where duplicate_of_id is null)::int as supplier_count,
       count(*) filter (where duplicate_of_id is not null)::int as duplicate_count,
       count(*) filter (where not abn_valid)::int           as invalid_abn_count,
       -- Every row's spend, counted once: a duplicate's spend belongs to the
       -- survivor it was merged into, and summing only primaries would drop it.
       coalesce(sum(fy_spend_aud), 0)                       as consolidated_spend_aud
     from suppliers
     where company_id = $1`,
    [companyId],
  );
  return rows[0];
}

/**
 * Fuel volumes, grouped the way the emissions views group them.
 *
 * Keyed on `factor_key`, not on `fuel_type`. The source spells the fuel as
 * "Diesel" and "Petrol (ULP)" — client vocabulary, preserved on the row — while
 * the factor key is the normalised join to `emission_factors`. An earlier
 * version of this query filtered on `fuel_type = 'diesel'` and reported zero
 * litres beside a Scope 1 total of 22,000 tonnes.
 *
 * The factor comes back with the volume so the fact can state the conversion it
 * rests on rather than repeating a number from a comment.
 */
export async function findFuelTotals(
  companyId: number,
): Promise<FuelTotalsRow[]> {
  const { rows } = await getPool().query<FuelTotalsRow>(
    `select
       f.factor_key,
       ef.activity,
       min(ef.unit)              as unit,
       min(ef.kg_co2e_per_unit)  as kg_co2e_per_unit,
       sum(f.quantity_l)         as quantity,
       count(*)::int             as deliveries
     from fuel_deliveries f
     join emission_factors ef on ef.factor_key = f.factor_key
     where f.company_id = $1
     group by f.factor_key, ef.activity
     order by f.factor_key`,
    [companyId],
  );
  return rows;
}

export async function findElectricityTotals(
  companyId: number,
): Promise<ElectricityTotalsRow | undefined> {
  const { rows } = await getPool().query<ElectricityTotalsRow>(
    `select
       coalesce((select sum(consumption_kwh) from electricity_readings
                  where company_id = $1), 0)                          as grid_kwh,
       (select kg_co2e_per_unit from emission_factors
         where factor_key = 'grid_electricity_qld')                   as kg_co2e_per_unit,
       (select count(*)::int from electricity_readings where company_id = $1) as meter_readings,
       (select count(*)::int from meters where company_id = $1)               as meters`,
    [companyId],
  );
  return rows[0];
}

const REPORT_COLUMNS = `
  id, period_from, period_to, facts, fact_digest, sections, rejected,
  claims_accepted, claims_rejected, provider, model, prompt_version,
  token_usage, to_char(generated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') as generated_at`;

/**
 * The newest report for this company, whatever data it was written against.
 *
 * Deliberately not filtered by fact digest. A report generated against figures
 * that have since moved is still the report this company published, and the
 * service re-verifies it against current facts and says so — which is more use
 * to a compliance reader than pretending no report exists.
 */
export async function findLatestReport(
  companyId: number,
): Promise<StoredReportRow | undefined> {
  const { rows } = await getPool().query<StoredReportRow>(
    `select ${REPORT_COLUMNS}
     from ai_compliance_reports
     where company_id = $1
     order by generated_at desc
     limit 1`,
    [companyId],
  );
  return rows[0];
}

export type ReportInsert = {
  companyId: number;
  userId: number | null;
  periodFrom: string;
  periodTo: string;
  facts: ReportFact[];
  factDigest: string;
  sections: ReportSectionOutput[];
  rejected: ReportRejection[];
  claimsAccepted: number;
  claimsRejected: number;
  provider: string;
  model: string;
  promptVersion: string;
  tokenUsage: unknown;
};

export async function insertReport(
  report: ReportInsert,
): Promise<StoredReportRow> {
  const { rows } = await getPool().query<StoredReportRow>(
    `insert into ai_compliance_reports (
       company_id, generated_by_user_id, period_from, period_to,
       facts, fact_digest, sections, rejected,
       claims_accepted, claims_rejected, provider, model, prompt_version, token_usage
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     -- Same company, model, prompt and fact pack: this is a re-run of the same
     -- document, so it replaces rather than accumulating a near-identical row.
     on conflict (company_id, model, prompt_version, fact_digest) do update set
       sections        = excluded.sections,
       rejected        = excluded.rejected,
       claims_accepted = excluded.claims_accepted,
       claims_rejected = excluded.claims_rejected,
       facts           = excluded.facts,
       token_usage     = excluded.token_usage,
       generated_at    = now(),
       generated_by_user_id = excluded.generated_by_user_id
     returning ${REPORT_COLUMNS}`,
    [
      report.companyId,
      report.userId,
      report.periodFrom,
      report.periodTo,
      JSON.stringify(report.facts),
      report.factDigest,
      JSON.stringify(report.sections),
      JSON.stringify(report.rejected),
      report.claimsAccepted,
      report.claimsRejected,
      report.provider,
      report.model,
      report.promptVersion,
      JSON.stringify(report.tokenUsage),
    ],
  );
  return rows[0] as StoredReportRow;
}
