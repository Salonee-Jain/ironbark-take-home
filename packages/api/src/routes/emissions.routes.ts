import type { FastifyInstance } from 'fastify';
import { companyIdOf } from '../middlewares/authenticate.js';
import { errorResponse, monthParam } from '../schemas/common.schema.js';
import * as service from '../services/emissions.service.js';

/**
 * Route definitions: path, schema, and the service call behind it. The schema
 * lives here because it is the public contract, and the handler stays a single
 * expression mapping the request onto a service argument.
 *
 * Every route carries `onRequest: app.authenticate` and reads its company from
 * the verified session. There is deliberately no `?company=` parameter anywhere
 * in this API.
 */

type MonthRangeQuery = { from?: string; to?: string };

export async function emissionsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: MonthRangeQuery }>(
    '/api/emissions/monthly',
    {
      onRequest: app.authenticate,
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
        response: { 401: errorResponse },
      },
    },
    (request) =>
      service.getMonthlyEmissions(companyIdOf(request), request.query),
  );

  app.get<{ Querystring: MonthRangeQuery }>(
    '/api/emissions/breakdown',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['emissions'],
        summary: 'Emissions by activity',
        description:
          'The per-activity rows behind the monthly totals — diesel, petrol, grid electricity — with ' +
          'the activity amount and unit alongside the resulting kg CO2e.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { from: monthParam, to: monthParam },
        },
        response: { 401: errorResponse },
      },
    },
    (request) =>
      service.getActivityBreakdown(companyIdOf(request), request.query),
  );

  app.get<{ Querystring: MonthRangeQuery }>(
    '/api/emissions/by-site-area',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['emissions'],
        summary: 'Scope 1 by site area',
        description:
          'Scope 1 only. The electricity meters are described by function and never mapped to the ' +
          'site-area vocabulary in the source, so a Scope 2 site breakdown would be guesswork.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { from: monthParam, to: monthParam },
        },
        response: { 401: errorResponse },
      },
    },
    (request) =>
      service.getScope1BySiteArea(companyIdOf(request), request.query),
  );

  app.get(
    '/api/emissions/summary',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['emissions'],
        summary: 'Period and financial-year totals',
        description:
          'Headline totals for the export and per Australian financial year. FY2026 (Jul 2025 - ' +
          'Jun 2026) is the only complete year in this data; partial years carry isCompleteYear false ' +
          'so they are not compared as though whole.',
        response: { 401: errorResponse },
      },
    },
    (request) => service.getSummary(companyIdOf(request)),
  );
}
