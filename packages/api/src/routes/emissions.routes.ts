import type { FastifyInstance } from 'fastify';
import * as controller from '../controllers/emissions.controller.js';
import { monthParam } from '../schemas/common.schema.js';

/**
 * Route definitions: path, schema, controller. No logic.
 *
 * The schema is here rather than in the controller because it is part of the
 * public contract — it is what Fastify validates and what /docs publishes.
 */
export async function emissionsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/emissions/monthly',
    {
      schema: {
        tags: ['emissions'],
        summary: 'Monthly emissions by scope',
        description:
          'Scope 1 (fuel combustion) and Scope 2 (grid electricity) per month, in kg CO2e, computed ' +
          'from cleaned activity data and the supplied emission factors. Each month reports how many ' +
          'source records it draws on and how many of those needed a data-quality correction.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { from: monthParam, to: monthParam },
        },
      },
    },
    controller.getMonthly,
  );

  app.get(
    '/api/emissions/breakdown',
    {
      schema: {
        tags: ['emissions'],
        summary: 'Emissions by activity',
        description:
          'The per-activity rows behind the monthly totals — diesel, petrol, grid electricity — with ' +
          'the activity amount and unit alongside the resulting kg CO2e.',
      },
    },
    controller.getBreakdown,
  );

  app.get(
    '/api/emissions/by-site-area',
    {
      schema: {
        tags: ['emissions'],
        summary: 'Scope 1 by site area',
        description:
          'Scope 1 only. The electricity meters are described by function and never mapped to the ' +
          'site-area vocabulary in the source, so a Scope 2 site breakdown would be guesswork.',
      },
    },
    controller.getBySiteArea,
  );

  app.get(
    '/api/emissions/summary',
    {
      schema: {
        tags: ['emissions'],
        summary: 'Period and financial-year totals',
        description:
          'Headline totals for the export and per Australian financial year. FY2026 (Jul 2025 - ' +
          'Jun 2026) is the only complete year in this data; partial years carry isCompleteYear false ' +
          'so they are not compared as though whole.',
      },
    },
    controller.getSummary,
  );
}
