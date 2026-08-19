import type { FastifyInstance } from 'fastify';
import { companyIdOf } from '../middlewares/authenticate.js';
import { errorResponse, monthParam } from '../schemas/common.schema.js';
import * as service from '../services/incidents.service.js';
import type { IncidentQuery } from '../services/incidents.service.js';

export async function incidentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: IncidentQuery }>(
    '/api/incidents',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['incidents'],
        summary: 'Incident register',
        description:
          'The cleaned register. severityRaw is preserved beside the normalised severity because the ' +
          'source records two different scales and a reviewer needs to see that.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            month: monthParam,
            from: monthParam,
            to: monthParam,
            type: { type: 'string', maxLength: 8 },
            severity: { type: 'integer', minimum: 1, maximum: 3 },
            psychosocial: {
              type: 'boolean',
              description:
                'Filter to incidents the AI layer identified as psychosocial hazards, regardless of ' +
                'how they were originally coded.',
            },
            search: {
              type: 'string',
              maxLength: 120,
              description:
                'Case-insensitive match against the description, location and incident id.',
            },
          },
        },
        response: { 401: errorResponse },
      },
    },
    (request) =>
      service.listIncidents(companyIdOf(request), request.query),
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/incidents/trends',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['incidents'],
        summary: 'Incident counts by month, type and severity',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { from: monthParam, to: monthParam },
        },
        response: { 401: errorResponse },
      },
    },
    (request) =>
      service.getTrends(companyIdOf(request), request.query),
  );

  app.get<{ Params: { id: string } }>(
    '/api/incidents/:id',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['incidents'],
        summary: 'One incident, with its full audit trail',
        description:
          'The record, every data-quality issue raised against its source line, and every AI finding ' +
          'that cites it — each with the verbatim quote it was drawn from and an evidenceVerified flag ' +
          're-checked at read time. This is what makes an AI claim checkable rather than merely plausible.',
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', maxLength: 32 } },
        },
        response: { 401: errorResponse, 404: errorResponse },
      },
    },
    // A missing incident throws NotFoundError from the service; the error
    // middleware renders the 404. An incident belonging to another company is
    // indistinguishable from one that does not exist, which is the correct
    // answer to give — confirming it exists would leak that much.
    (request) =>
      service.getIncidentDetail(companyIdOf(request), request.params.id),
  );
}
