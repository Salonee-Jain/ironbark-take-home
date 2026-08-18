import type { FastifyInstance } from 'fastify';
import * as controller from '../controllers/incidents.controller.js';
import { errorResponse, monthParam } from '../schemas/common.schema.js';

export async function incidentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/incidents',
    {
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
            type: { type: 'string', maxLength: 8 },
            severity: { type: 'integer', minimum: 1, maximum: 3 },
            psychosocial: {
              type: 'boolean',
              description:
                'Filter to incidents the AI layer identified as psychosocial hazards, regardless of ' +
                'how they were originally coded.',
            },
          },
        },
      },
    },
    controller.listIncidents,
  );

  app.get(
    '/api/incidents/trends',
    {
      schema: {
        tags: ['incidents'],
        summary: 'Incident counts by month, type and severity',
      },
    },
    controller.getTrends,
  );

  app.get(
    '/api/incidents/:id',
    {
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
        response: { 404: errorResponse },
      },
    },
    controller.getIncidentDetail,
  );
}
