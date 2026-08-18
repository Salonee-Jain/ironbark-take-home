import type { FastifyInstance } from 'fastify';
import * as service from '../services/health.service.js';
import { errorResponse } from '../schemas/common.schema.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness and database connectivity',
        response: { 503: errorResponse },
      },
    },
    // Failure throws ServiceUnavailableError; the middleware renders the 503.
    service.getHealth,
  );
}
