import { getPool } from '@ironbark/db';
import type { FastifyInstance } from 'fastify';

/**
 * Incident endpoints.
 *
 * `/api/incidents/:id` is the traceability endpoint: one record, everything the
 * pipeline did to it, and everything the AI concluded about it, in one response.
 * Any AI-derived claim in the UI has to be clickable through to this, or it is
 * an assertion with nothing behind it.
 */

type IncidentQuery = {
  month?: string;
  type?: string;
  severity?: number;
  psychosocial?: boolean;
};

export async function incidentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: IncidentQuery }>(
    '/api/incidents',
    {
      schema: {
        tags: ['incidents'],
        summary: 'Incident register',
        description:
          'The cleaned register. `severityRaw` is preserved next to the normalised severity ' +
          'because the source records two different scales and a reviewer needs to see that.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
            type: { type: 'string', maxLength: 8 },
            severity: { type: 'integer', minimum: 1, maximum: 3 },
            psychosocial: {
              type: 'boolean',
              description:
                'Filter to incidents the AI layer identified as psychosocial hazards, ' +
                'regardless of how they were originally coded.',
            },
          },
        },
      },
    },
    async (request) => {
      const { month, type, severity, psychosocial } = request.query;

      const { rows } = await getPool().query(
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
         -- Lateral, not a plain join: an incident can carry findings from more
         -- than one model or prompt version, and joining them directly would
         -- return the same incident once per finding. Newest run wins.
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
        [
          month ? `${month}-01` : null,
          type ?? null,
          severity ?? null,
          psychosocial ?? null,
        ],
      );

      return { incidents: rows };
    },
  );

  app.get(
    '/api/incidents/trends',
    {
      schema: {
        tags: ['incidents'],
        summary: 'Incident counts by month, type and severity',
      },
    },
    async () => {
      const pool = getPool();

      const [byMonth, byType, bySeverity] = await Promise.all([
        pool.query(
          `select
             to_char(month, 'YYYY-MM') as month,
             sum(incident_count)::int  as incident_count,
             sum(incident_count) filter (where severity = 3)::int as severity_3,
             sum(incident_count) filter (where severity = 2)::int as severity_2,
             sum(incident_count) filter (where severity = 1)::int as severity_1
           from v_incident_monthly
           group by month
           order by month`,
        ),
        pool.query(
          `select
             type_code,
             coalesce(type_label, 'Unknown code') as type_label,
             sum(incident_count)::int             as incident_count
           from v_incident_monthly
           group by type_code, type_label
           order by sum(incident_count) desc`,
        ),
        pool.query(
          `select severity, sum(incident_count)::int as incident_count
           from v_incident_monthly
           group by severity
           order by severity`,
        ),
      ]);

      return {
        byMonth: byMonth.rows,
        byType: byType.rows,
        bySeverity: bySeverity.rows,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/incidents/:id',
    {
      schema: {
        tags: ['incidents'],
        summary: 'One incident, with its full audit trail',
        description:
          'The record, every data-quality issue raised against its source row, and every AI finding ' +
          'that cites it — each with the verbatim quote it was drawn from. This is what makes an ' +
          'AI-generated claim checkable rather than merely plausible.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', maxLength: 32 } },
        },
      },
    },
    async (request, reply) => {
      const pool = getPool();
      const { id } = request.params;

      const { rows } = await pool.query(
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

      const incident = rows[0];
      if (!incident) {
        return reply.code(404).send({
          error: 'not_found',
          message: `No incident with id ${id}`,
        });
      }

      const [issues, findings] = await Promise.all([
        pool.query(
          `select q.rule_id, r.title as rule_title, r.rationale,
                  q.severity, q.action, q.description, q.original_value, q.resolved_value
           from data_quality_issues q
           join data_quality_rules r on r.rule_id = q.rule_id
           where q.source_file = 'incident_register.csv'
             and q.source_row_number = $1
           order by q.severity, q.rule_id`,
          [incident.source_row_number],
        ),
        pool.query(
          `select category, is_psychosocial, severity_assessment, severity_mismatch,
                  confidence, evidence_quote, rationale, model, prompt_version,
                  created_at
           from ai_incident_findings
           where incident_id = $1
           order by created_at desc`,
          [id],
        ),
      ]);

      return {
        incident,
        dataQualityIssues: issues.rows,
        aiFindings: findings.rows.map((finding) => ({
          ...finding,
          // Re-checked at read time, not just at write time. The database
          // trigger already refuses ungrounded findings; this proves it to the
          // client on every request rather than asking them to trust it.
          evidenceVerified:
            typeof finding.evidence_quote === 'string' &&
            String(incident.description).includes(finding.evidence_quote),
        })),
      };
    },
  );
}
