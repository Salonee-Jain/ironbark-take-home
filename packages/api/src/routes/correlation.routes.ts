import type { FastifyInstance } from 'fastify';
import * as service from '../services/correlation.service.js';
import { companyIdOf } from '../middlewares/authenticate.js';

/**
 * Cross-dataset correlation.
 *
 * One endpoint, because it answers one question: is there a month where the
 * three datasets tell a single story, and what is it?
 *
 * It returns `detected: false` with a reason rather than a 404 when there is no
 * such month. A newly signed-up company with no data is not an error, and an
 * endpoint that 404s on "nothing unusual happened" forces the client to treat a
 * normal result as a failure.
 */
export async function correlationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/analysis/outage',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['analysis'],
        summary: 'Cross-dataset correlation for a supply-outage month',
        description:
          'Finds the month whose site-wide grid consumption is a downward outlier against the ' +
          'rest of the period, then assembles the causal chain across the electricity, fuel and ' +
          'incident datasets, plus a counterfactual for what the month would have emitted on ' +
          'normal supply.\n\n' +
          'Nothing is hard-coded: the month, the meters, the root-cause incident and its ' +
          'consequences are all detected. The same robust outlier test is used here as in the ' +
          'ETL anomaly rules, so this view cannot narrate an event the data-quality report did ' +
          'not flag.\n\n' +
          'The counterfactual carries its own `assumption` field. It compares the month against ' +
          'a median month rather than forecasting, and the payload says so rather than leaving ' +
          'the client to present an estimate as a measurement.',
        response: {
          200: {
            type: 'object',
            properties: {
              detected: { type: 'boolean' },
              month: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
      },
    },
    async (request) => service.getOutageAnalysis(companyIdOf(request)),
  );
}
