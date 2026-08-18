import { getPool } from '@ironbark/db';
import type { FastifyInstance } from 'fastify';

/**
 * The data-quality report.
 *
 * Structured, not prose: grouped counts for the overview, the full issue list
 * for the detail, and the rule catalogue with its rationale so a user can see
 * *why* a correction was considered legitimate without reading the source.
 */

type IssueQuery = {
  file?: string;
  severity?: string;
  action?: string;
  rule?: string;
  limit?: number;
};

export async function dataQualityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/data-quality',
    {
      schema: {
        tags: ['data quality'],
        summary: 'Data-quality overview',
        description:
          'Counts by source file, severity and action, plus the per-rule roll-up. ' +
          '`action` is the editorial decision: fixed (corrected in flight, original retained), ' +
          'flagged (loaded as-is, needs a human), rejected (excluded from analytics but recorded here).',
      },
    },
    async () => {
      const pool = getPool();

      const [totals, byFile, bySeverity, byAction, byRule] = await Promise.all([
        pool.query(
          `select count(*)::int as total_issues,
                  count(distinct rule_id)::int as rules_triggered
           from data_quality_issues`,
        ),
        pool.query(
          `select source_file,
                  count(*)::int as issue_count,
                  count(*) filter (where severity = 'error')::int   as errors,
                  count(*) filter (where severity = 'warning')::int as warnings,
                  count(*) filter (where severity = 'info')::int    as infos
           from data_quality_issues
           group by source_file
           order by count(*) desc`,
        ),
        pool.query(
          `select severity, count(*)::int as issue_count
           from data_quality_issues group by severity`,
        ),
        pool.query(
          `select action, count(*)::int as issue_count
           from data_quality_issues group by action`,
        ),
        pool.query(
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
        ),
      ]);

      return {
        totals: totals.rows[0],
        byFile: byFile.rows,
        bySeverity: bySeverity.rows,
        byAction: byAction.rows,
        byRule: byRule.rows,
      };
    },
  );

  app.get<{ Querystring: IssueQuery }>(
    '/api/data-quality/issues',
    {
      schema: {
        tags: ['data quality'],
        summary: 'Individual findings',
        description:
          'Every issue, each pointing at the physical line in the source file so a reviewer can ' +
          'open the CSV and see the original for themselves.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file: { type: 'string', maxLength: 64 },
            severity: { type: 'string', enum: ['error', 'warning', 'info'] },
            action: { type: 'string', enum: ['fixed', 'flagged', 'rejected'] },
            rule: { type: 'string', maxLength: 32 },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
          },
        },
      },
    },
    async (request) => {
      const { file, severity, action, rule, limit = 200 } = request.query;

      const { rows } = await getPool().query(
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
        [file ?? null, severity ?? null, action ?? null, rule ?? null, limit],
      );

      return { issues: rows, returned: rows.length, limit };
    },
  );

  app.get(
    '/api/data-quality/rules',
    {
      schema: {
        tags: ['data quality'],
        summary: 'The rule catalogue',
        description:
          'Every rule the pipeline can raise, including those that did not fire on this data. ' +
          'A rule that found nothing is itself information: it says the check ran and passed.',
      },
    },
    async () => {
      const { rows } = await getPool().query(
        `select r.rule_id, r.title, r.source_file, r.category,
                r.default_severity, r.default_action, r.rationale,
                count(q.id)::int as issue_count
         from data_quality_rules r
         left join data_quality_issues q on q.rule_id = r.rule_id
         group by r.rule_id, r.title, r.source_file, r.category,
                  r.default_severity, r.default_action, r.rationale
         order by count(q.id) desc, r.rule_id`,
      );

      return { rules: rows };
    },
  );
}
