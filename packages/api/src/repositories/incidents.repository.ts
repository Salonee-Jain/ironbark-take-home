import { getPool } from '@ironbark/db';

export type IncidentFilters = {
  month: string | null;
  typeCode: string | null;
  severity: number | null;
  psychosocial: boolean | null;
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
       order by f2.created_at desc
       limit 1
     ) f on true
     left join data_quality_issues q
            on q.source_file = 'incident_register.csv'
           and q.source_row_number = i.source_row_number
     where ($1::date is null or date_trunc('month', i.incident_date) = $1::date)
       and ($2::text is null or i.type_code = $2::text)
       and ($3::int  is null or i.severity = $3::int)
       and ($4::bool is null or coalesce(f.is_psychosocial, false) = $4::bool)
     group by i.id, t.label, f.is_psychosocial, f.severity_mismatch, f.category
     order by i.incident_date, i.id`,
    [filters.month, filters.typeCode, filters.severity, filters.psychosocial],
  );
  return rows;
}

export async function findIncidentById(
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
     where i.id = $1`,
    [id],
  );
  return rows[0];
}

export async function findIssuesForSourceRow(
  sourceRowNumber: number,
): Promise<IncidentIssueRow[]> {
  const { rows } = await getPool().query<IncidentIssueRow>(
    `select q.rule_id, r.title as rule_title, r.rationale,
            q.severity, q.action, q.description, q.original_value, q.resolved_value
     from data_quality_issues q
     join data_quality_rules r on r.rule_id = q.rule_id
     where q.source_file = 'incident_register.csv'
       and q.source_row_number = $1
     order by q.severity, q.rule_id`,
    [sourceRowNumber],
  );
  return rows;
}

export async function findAiFindings(
  incidentId: string,
): Promise<AiFindingRow[]> {
  const { rows } = await getPool().query<AiFindingRow>(
    `select category, is_psychosocial, severity_assessment, severity_mismatch,
            confidence, evidence_quote, rationale, model, prompt_version, created_at
     from ai_incident_findings
     where incident_id = $1
     order by created_at desc`,
    [incidentId],
  );
  return rows;
}

export async function countByMonth(): Promise<MonthlyIncidentRow[]> {
  const { rows } = await getPool().query<MonthlyIncidentRow>(
    `select
       to_char(month, 'YYYY-MM') as month,
       sum(incident_count)::int  as incident_count,
       sum(incident_count) filter (where severity = 3)::int as severity_3,
       sum(incident_count) filter (where severity = 2)::int as severity_2,
       sum(incident_count) filter (where severity = 1)::int as severity_1
     from v_incident_monthly
     group by month
     order by month`,
  );
  return rows;
}

export async function countByType(): Promise<TypeCountRow[]> {
  const { rows } = await getPool().query<TypeCountRow>(
    `select
       type_code,
       coalesce(type_label, 'Unknown code') as type_label,
       sum(incident_count)::int             as incident_count
     from v_incident_monthly
     group by type_code, type_label
     order by sum(incident_count) desc`,
  );
  return rows;
}

export async function countBySeverity(): Promise<SeverityCountRow[]> {
  const { rows } = await getPool().query<SeverityCountRow>(
    `select severity, sum(incident_count)::int as incident_count
     from v_incident_monthly
     group by severity
     order by severity`,
  );
  return rows;
}
