import { getPool } from '@ironbark/db';

export type IncidentFilters = {
  /** A single month, `YYYY-MM-01`. Wins over the range when both are set. */
  month: string | null;
  /** Inclusive month bounds, `YYYY-MM-01`. */
  from: string | null;
  to: string | null;
  typeCode: string | null;
  severity: number | null;
  psychosocial: boolean | null;
  /** Free text matched against the description, location and id. */
  search: string | null;
};

export type IncidentListRow = {
  id: string;
  source_incident_id: string;
  incident_date: string;
  location: string;
  type_code: string;
  type_label: string | null;
  severity: number | null;
  severity_raw: string;
  description: string;
  source_row_number: number;
  ai_is_psychosocial: boolean;
  ai_severity_mismatch: boolean;
  ai_category: string | null;
  quality_issue_count: number;
};

export type IncidentDetailRow = Omit<
  IncidentListRow,
  'ai_is_psychosocial' | 'ai_severity_mismatch' | 'ai_category' | 'quality_issue_count'
>;

export type IncidentIssueRow = {
  rule_id: string;
  rule_title: string;
  rationale: string;
  severity: string;
  action: string;
  description: string;
  original_value: string | null;
  resolved_value: string | null;
};

export type AiFindingRow = {
  category: string;
  is_psychosocial: boolean;
  severity_assessment: number | null;
  severity_mismatch: boolean;
  confidence: number | null;
  evidence_quote: string;
  rationale: string;
  model: string;
  prompt_version: string;
  created_at: Date;
};

export type MonthlyIncidentRow = {
  month: string;
  incident_count: number;
  severity_3: number | null;
  severity_2: number | null;
  severity_1: number | null;
};

export type TypeCountRow = {
  type_code: string;
  type_label: string;
  incident_count: number;
};

export type SeverityCountRow = {
  severity: number | null;
  incident_count: number;
};

export async function findIncidents(
  companyId: number,
  filters: IncidentFilters,
): Promise<IncidentListRow[]> {
  const { rows } = await getPool().query<IncidentListRow>(
    `select
       i.id,
       i.source_incident_id,
       to_char(i.incident_date, 'YYYY-MM-DD') as incident_date,
       i.location_raw                         as location,
       i.type_code,
       t.label                                as type_label,
       i.severity,
       i.severity_raw,
       i.description,
       i.source_row_number,
       coalesce(f.is_psychosocial, false)     as ai_is_psychosocial,
       coalesce(f.severity_mismatch, false)   as ai_severity_mismatch,
       f.category                             as ai_category,
       count(q.id)::int                       as quality_issue_count
     from incidents i
     left join incident_types t on t.code = i.type_code
     -- Lateral, not a plain join: an incident can carry findings from more than
     -- one model or prompt version, and joining them directly would return the
     -- same incident once per finding. Newest run wins.
     left join lateral (
       select f2.is_psychosocial, f2.severity_mismatch, f2.category
       from ai_incident_findings f2
       where f2.incident_id = i.id
         and f2.company_id = i.company_id
       order by f2.created_at desc
       limit 1
     ) f on true
     left join data_quality_issues q
            on q.company_id = i.company_id
           and q.source_file = 'incident_register.csv'
           and q.source_row_number = i.source_row_number
     where i.company_id = $1
       and ($2::date is null or date_trunc('month', i.incident_date) = $2::date)
       and ($3::date is null or i.incident_date >= $3::date)
       and ($4::date is null or i.incident_date < ($4::date + interval '1 month'))
       and ($5::text is null or i.type_code = $5::text)
       and ($6::int  is null or i.severity = $6::int)
       and ($7::bool is null or coalesce(f.is_psychosocial, false) = $7::bool)
       -- Case-insensitive contains across the three fields someone would
       -- actually search by. Not full-text: the register is 42 rows, and a
       -- tsvector index here would be ceremony that has to be kept in sync.
       and ($8::text is null or (
             i.description ilike '%' || $8 || '%'
          or i.location_raw ilike '%' || $8 || '%'
          or i.id ilike '%' || $8 || '%'
       ))
     group by i.id, i.company_id, t.label, f.is_psychosocial, f.severity_mismatch, f.category
     order by i.incident_date, i.id`,
    [
      companyId,
      filters.month,
      filters.from,
      filters.to,
      filters.typeCode,
      filters.severity,
      filters.psychosocial,
      filters.search,
    ],
  );
  return rows;
}

export async function findIncidentById(
  companyId: number,
  id: string,
): Promise<IncidentDetailRow | undefined> {
  const { rows } = await getPool().query<IncidentDetailRow>(
    `select
       i.id,
       i.source_incident_id,
       to_char(i.incident_date, 'YYYY-MM-DD') as incident_date,
       i.location_raw as location,
       i.type_code,
       t.label as type_label,
       i.severity,
       i.severity_raw,
       i.description,
       i.source_row_number
     from incidents i
     left join incident_types t on t.code = i.type_code
     where i.company_id = $1 and i.id = $2`,
    [companyId, id],
  );
  return rows[0];
}

export async function findIssuesForSourceRow(
  companyId: number,
  sourceRowNumber: number,
): Promise<IncidentIssueRow[]> {
  const { rows } = await getPool().query<IncidentIssueRow>(
    `select q.rule_id, r.title as rule_title, r.rationale,
            q.severity, q.action, q.description, q.original_value, q.resolved_value
     from data_quality_issues q
     join data_quality_rules r on r.rule_id = q.rule_id
     where q.company_id = $1
       and q.source_file = 'incident_register.csv'
       and q.source_row_number = $2
     order by q.severity, q.rule_id`,
    [companyId, sourceRowNumber],
  );
  return rows;
}

export async function findAiFindings(
  companyId: number,
  incidentId: string,
): Promise<AiFindingRow[]> {
  const { rows } = await getPool().query<AiFindingRow>(
    `select category, is_psychosocial, severity_assessment, severity_mismatch,
            confidence, evidence_quote, rationale, model, prompt_version, created_at
     from ai_incident_findings
     where company_id = $1 and incident_id = $2
     order by created_at desc`,
    [companyId, incidentId],
  );
  return rows;
}

export async function countByMonth(
  companyId: number,
  range: { from: string | null; to: string | null },
): Promise<MonthlyIncidentRow[]> {
  const { rows } = await getPool().query<MonthlyIncidentRow>(
    `select
       to_char(month, 'YYYY-MM') as month,
       sum(incident_count)::int  as incident_count,
       sum(incident_count) filter (where severity = 3)::int as severity_3,
       sum(incident_count) filter (where severity = 2)::int as severity_2,
       sum(incident_count) filter (where severity = 1)::int as severity_1
     from v_incident_monthly
     where company_id = $1
       and ($2::date is null or month >= $2::date)
       and ($3::date is null or month <= $3::date)
     group by month
     order by month`,
    [companyId, range.from, range.to],
  );
  return rows;
}

export async function countByType(
  companyId: number,
  range: { from: string | null; to: string | null },
): Promise<TypeCountRow[]> {
  const { rows } = await getPool().query<TypeCountRow>(
    `select
       type_code,
       coalesce(type_label, 'Unknown code') as type_label,
       sum(incident_count)::int             as incident_count
     from v_incident_monthly
     where company_id = $1
       and ($2::date is null or month >= $2::date)
       and ($3::date is null or month <= $3::date)
     group by type_code, type_label
     order by sum(incident_count) desc`,
    [companyId, range.from, range.to],
  );
  return rows;
}

export async function countBySeverity(
  companyId: number,
  range: { from: string | null; to: string | null },
): Promise<SeverityCountRow[]> {
  const { rows } = await getPool().query<SeverityCountRow>(
    `select severity, sum(incident_count)::int as incident_count
     from v_incident_monthly
     where company_id = $1
       and ($2::date is null or month >= $2::date)
       and ($3::date is null or month <= $3::date)
     group by severity
     order by severity`,
    [companyId, range.from, range.to],
  );
  return rows;
}
