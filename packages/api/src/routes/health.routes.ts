import type { FastifyInstance } from 'fastify';
import * as service from '../services/health.service.js';
import { errorResponse } from '../schemas/common.schema.js';

/**
 * Registered at two paths. `/health` is what a load balancer or a local script
 * asks for; `/api/health` is the one that survives deployment, because on the
 * hosted build everything under /api is the function and everything else is the
 * static site.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  for (const path of ['/health', '/api/health']) {
    app.get(
      path,
      {
        schema: {
          tags: ['health'],
          summary: 'Liveness and database connectivity',
          response: { 503: errorResponse },
          // One entry in the OpenAPI document rather than two identical ones.
          ...(path === '/health' ? {} : { hide: true }),
        },
      },
      // Failure throws ServiceUnavailableError; the middleware renders the 503.
      service.getHealth,
    );
  }
}
