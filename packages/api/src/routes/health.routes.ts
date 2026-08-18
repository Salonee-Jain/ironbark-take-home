import type { FastifyInstance } from 'fastify';
import * as controller from '../controllers/health.controller.js';
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
    controller.getHealth,
  );
}
