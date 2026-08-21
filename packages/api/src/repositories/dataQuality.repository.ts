import { getPool } from '@ironbark/db';

export type IssueFilters = {
  sourceFile: string | null;
  severity: string | null;
  action: string | null;
  ruleId: string | null;
  /** Free text matched against the description, record key and rule id. */
  search: string | null;
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

export async function findTotals(
  companyId: number,
): Promise<TotalsRow | undefined> {
  const { rows } = await getPool().query<TotalsRow>(
    `select count(*)::int as total_issues,
            count(distinct rule_id)::int as rules_triggered
     from data_quality_issues
     where company_id = $1`,
    [companyId],
  );
  return rows[0];
}

export async function countByFile(
  companyId: number,
): Promise<FileSummaryRow[]> {
  const { rows } = await getPool().query<FileSummaryRow>(
    `select source_file,
            count(*)::int as issue_count,
            count(*) filter (where severity = 'error')::int   as errors,
            count(*) filter (where severity = 'warning')::int as warnings,
            count(*) filter (where severity = 'info')::int    as infos
     from data_quality_issues
     where company_id = $1
     group by source_file
     order by count(*) desc`,
    [companyId],
  );
  return rows;
}

/**
 * Grouped counts for a single column.
 *
 * The column name is interpolated rather than parameterised, which SQL does not
 * allow for identifiers. It is safe because the parameter is a two-value union
 * the compiler checks, and the function is not exported, the only callers are
 * the two below. Anything reaching this from a request body would need a new
 * caller, which is a change a reviewer would see.
 */
async function countByColumn(
  companyId: number,
  column: 'severity' | 'action',
): Promise<CountRow[]> {
  const { rows } = await getPool().query<CountRow>(
    `select ${column} as key, count(*)::int as issue_count
     from data_quality_issues
     where company_id = $1
     group by ${column} order by count(*) desc`,
    [companyId],
  );
  return rows;
}

export const countBySeverity = (companyId: number): Promise<CountRow[]> =>
  countByColumn(companyId, 'severity');
export const countByAction = (companyId: number): Promise<CountRow[]> =>
  countByColumn(companyId, 'action');

export async function countByRule(
  companyId: number,
): Promise<RuleSummaryRow[]> {
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
     where q.company_id = $1
     group by q.rule_id, r.title, r.source_file, r.category,
              r.default_severity, r.default_action, r.rationale
     order by count(*) desc, q.rule_id`,
    [companyId],
  );
  return rows;
}

export async function findIssues(
  companyId: number,
  filters: IssueFilters,
): Promise<IssueRow[]> {
  const { rows } = await getPool().query<IssueRow>(
    `select q.id, q.rule_id, r.title as rule_title, r.rationale,
            q.source_file, q.source_row_number, q.record_key, q.field,
            q.severity, q.action, q.description,
            q.original_value, q.resolved_value
     from data_quality_issues q
     join data_quality_rules r on r.rule_id = q.rule_id
     where q.company_id = $1
       and ($2::text is null or q.source_file = $2)
       and ($3::text is null or q.severity = $3)
       and ($4::text is null or q.action = $4)
       and ($5::text is null or q.rule_id = $5)
       and ($6::text is null or (
             q.description ilike '%' || $6 || '%'
          or q.record_key  ilike '%' || $6 || '%'
          or q.rule_id     ilike '%' || $6 || '%'
       ))
     order by
       case q.severity when 'error' then 0 when 'warning' then 1 else 2 end,
       q.source_file,
       q.source_row_number nulls first
     limit $7`,
    [
      companyId,
      filters.sourceFile,
      filters.severity,
      filters.action,
      filters.ruleId,
      filters.search,
      filters.limit,
    ],
  );
  return rows;
}

/**
 * The whole rule catalogue with this company's hit counts.
 *
 * A left join from `data_quality_rules`, not from the issues, because a rule
 * that fired zero times is a result: it is evidence the check ran and found
 * nothing. The company predicate has to sit in the join condition rather than
 * a where clause, in a where clause it would discard the null rows the left
 * join exists to produce, turning the catalogue back into a list of hits.
 */
export async function findAllRules(
  companyId: number,
): Promise<RuleSummaryRow[]> {
  const { rows } = await getPool().query<RuleSummaryRow>(
    `select r.rule_id, r.title, r.source_file, r.category,
            r.default_severity as severity, r.default_action as action, r.rationale,
            count(q.id)::int as issue_count
     from data_quality_rules r
     left join data_quality_issues q
            on q.rule_id = r.rule_id and q.company_id = $1
     group by r.rule_id, r.title, r.source_file, r.category,
              r.default_severity, r.default_action, r.rationale
     order by count(q.id) desc, r.rule_id`,
    [companyId],
  );
  return rows;
}
