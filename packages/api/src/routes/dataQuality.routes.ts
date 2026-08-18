import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as service from '../services/dataQuality.service.js';
import type { IssueQuery } from '../services/dataQuality.service.js';

export async function dataQualityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/data-quality',
    {
      schema: {
        tags: ['data quality'],
        summary: 'Data-quality overview',
        description:
          'Counts by source file, severity and action, plus the per-rule roll-up. action is the ' +
          'editorial decision: fixed (corrected in flight, original retained), flagged (loaded as-is, ' +
          'needs a human), rejected (excluded from analytics but recorded here in full).',
      },
    },
    service.getOverview,
  );

  app.get(
    '/api/data-quality/issues',
    {
      schema: {
        tags: ['data quality'],
        summary: 'Individual findings',
        description:
          'Every issue, each pointing at the physical line in the source file so a reviewer can open ' +
          'the CSV and see the original for themselves.',
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
    (request: FastifyRequest<{ Querystring: IssueQuery }>) =>
      service.listIssues(request.query),
  );

  app.get(
    '/api/data-quality/rules',
    {
      schema: {
        tags: ['data quality'],
        summary: 'The rule catalogue',
        description:
          'Every rule the pipeline can raise, including those that did not fire. A rule that found ' +
          'nothing is itself information: it says the check ran and passed.',
      },
    },
    service.listRules,
  );
}
