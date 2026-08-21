import type { FastifyInstance } from 'fastify';
import { companyIdOf } from '../middlewares/authenticate.js';
import { errorResponse } from '../schemas/common.schema.js';
import * as service from '../services/reports.service.js';

/**
 * The AI compliance summary.
 *
 * GET serves the current one; POST spends money to write a new one, so it is
 * owner-only and the session supplies both the company and the author.
 */
export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/reports/summary',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['reports'],
        summary: 'The cited compliance summary for this workspace',
        description:
          'A narrative period summary in which every claim carries citations to a closed set of ' +
          'pre-computed facts. Claims are re-verified against the current figures on every read, ' +
          'so a summary cannot outlive the numbers it describes — `verification.claimsDroppedOnRead` ' +
          'reports anything that no longer holds.\n\n' +
          'Returns `available: false` with a reason when no summary has been generated, rather than ' +
          'a 404: a workspace without one is a normal state, not an error.',
        response: {
          200: {
            type: 'object',
            properties: { available: { type: 'boolean' } },
            additionalProperties: true,
          },
          401: errorResponse,
        },
      },
    },
    (request) => service.getSummary(companyIdOf(request)),
  );

  app.post<{ Body: { provider?: string } }>(
    '/api/reports/summary',
    {
      onRequest: app.requireOwner,
      schema: {
        tags: ['reports'],
        summary: 'Generate a new compliance summary',
        description:
          'Assembles the fact pack from the cleaned data, asks the configured model to write the ' +
          'summary against it, and stores only the claims that survive the citation gate. Requires ' +
          'ANTHROPIC_API_KEY or OPENAI_API_KEY on the server; 503 when neither is set.\n\n' +
          'Owner-only: it spends money and publishes a document under the company name.',
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            provider: {
              type: 'string',
              enum: ['anthropic', 'openai'],
              description:
                'Which vendor to use for this run. Optional; inferred from whichever key is set.',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: { available: { type: 'boolean' } },
            additionalProperties: true,
          },
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      },
    },
    (request) =>
      service.generateSummary(
        companyIdOf(request),
        { userId: Number(request.session?.sub) || null },
        { provider: request.body?.provider },
      ),
  );
}
