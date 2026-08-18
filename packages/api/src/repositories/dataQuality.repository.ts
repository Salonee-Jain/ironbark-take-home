import { getPool } from '@ironbark/db';

export type IssueFilters = {
  sourceFile: string | null;
  severity: string | null;
  action: string | null;
  ruleId: string | null;
  limit: number;
};

export type TotalsRow = { total_issues: number; rules_triggered: number };

export type FileSummaryRow = {
  source_file: string;
  issue_count: number;
  errors: number;
  warnings: number;
  infos: number;
};

export type CountRow = { key: string; issue_count: number };

export type RuleSummaryRow = {
  rule_id: string;
  title: string;
  source_file: string;
  category: string;
  severity: string;
  action: string;
  rationale: string;
  issue_count: number;
};

export type IssueRow = {
  id: number;
  rule_id: string;
  rule_title: string;
  rationale: string;
  source_file: string;
  source_row_number: number | null;
  record_key: string | null;
  field: string | null;
  severity: string;
  action: string;
  description: string;
  original_value: string | null;
  resolved_value: string | null;
};

export async function findTotals(): Promise<TotalsRow | undefined> {
  const { rows } = await getPool().query<TotalsRow>(
    `select count(*)::int as total_issues,
            count(distinct rule_id)::int as rules_triggered
     from data_quality_issues`,
  );
  return rows[0];
}

export async function countByFile(): Promise<FileSummaryRow[]> {
  const { rows } = await getPool().query<FileSummaryRow>(
    `select source_file,
            count(*)::int as issue_count,
            count(*) filter (where severity = 'error')::int   as errors,
            count(*) filter (where severity = 'warning')::int as warnings,
            count(*) filter (where severity = 'info')::int    as infos
     from data_quality_issues
     group by source_file
     order by count(*) desc`,
  );
  return rows;
}

/** Grouped counts for a single column. Column name is not user input. */
async function countByColumn(column: 'severity' | 'action'): Promise<CountRow[]> {
  const { rows } = await getPool().query<CountRow>(
    `select ${column} as key, count(*)::int as issue_count
     from data_quality_issues group by ${column} order by count(*) desc`,
  );
  return rows;
}

export const countBySeverity = (): Promise<CountRow[]> =>
  countByColumn('severity');
export const countByAction = (): Promise<CountRow[]> => countByColumn('action');

export async function countByRule(): Promise<RuleSummaryRow[]> {
  const { rows } = await getPool().query<RuleSummaryRow>(
    `select q.rule_id,
            r.title,
            r.source_file,
            r.category,
            r.default_severity as severity,
            r.default_action   as action,
            r.rationale,
            count(*)::int      as issue_count
     from data_quality_issues q
     join data_quality_rules r on r.rule_id = q.rule_id
     group by q.rule_id, r.title, r.source_file, r.category,
              r.default_severity, r.default_action, r.rationale
     order by count(*) desc, q.rule_id`,
  );
  return rows;
}

export async function findIssues(filters: IssueFilters): Promise<IssueRow[]> {
  const { rows } = await getPool().query<IssueRow>(
    `select q.id, q.rule_id, r.title as rule_title, r.rationale,
            q.source_file, q.source_row_number, q.record_key, q.field,
            q.severity, q.action, q.description,
            q.original_value, q.resolved_value
     from data_quality_issues q
     join data_quality_rules r on r.rule_id = q.rule_id
     where ($1::text is null or q.source_file = $1)
       and ($2::text is null or q.severity = $2)
       and ($3::text is null or q.action = $3)
       and ($4::text is null or q.rule_id = $4)
     order by
       case q.severity when 'error' then 0 when 'warning' then 1 else 2 end,
       q.source_file,
       q.source_row_number nulls first
     limit $5`,
    [
      filters.sourceFile,
      filters.severity,
      filters.action,
      filters.ruleId,
      filters.limit,
    ],
  );
  return rows;
}

export async function findAllRules(): Promise<RuleSummaryRow[]> {
  const { rows } = await getPool().query<RuleSummaryRow>(
    `select r.rule_id, r.title, r.source_file, r.category,
            r.default_severity as severity, r.default_action as action, r.rationale,
            count(q.id)::int as issue_count
     from data_quality_rules r
     left join data_quality_issues q on q.rule_id = r.rule_id
     group by r.rule_id, r.title, r.source_file, r.category,
              r.default_severity, r.default_action, r.rationale
     order by count(q.id) desc, r.rule_id`,
  );
  return rows;
}
