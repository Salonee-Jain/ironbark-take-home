import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { getPool } from '@ironbark/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { dataQualityRoutes } from './routes/dataQuality.js';
import { emissionsRoutes } from './routes/emissions.js';
import { incidentRoutes } from './routes/incidents.js';
import { supplierRoutes } from './routes/suppliers.js';

/**
 * Builds the server without starting it.
 *
 * Separated from `index.ts` so the integration tests in step 8 can drive it
 * through `app.inject()` — no port, no listening socket, no teardown races.
 */
export function buildServer(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // Query strings arrive as strings; without coercion `severity=2` fails an
    // integer schema and `psychosocial=true` never matches a boolean.
    ajv: { customOptions: { coerceTypes: true } },
  });

  app.register(cors, { origin: true });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Ironbark Ridge API',
        description:
          'Emissions, safety and data-quality intelligence over 18 months of operational data. ' +
          'Every figure is computed from cleaned source records; every AI finding cites the record it came from.',
        version: '0.1.0',
      },
      tags: [
        { name: 'emissions', description: 'Scope 1 and Scope 2' },
        { name: 'incidents', description: 'Safety register and trends' },
        { name: 'data quality', description: 'What was wrong with the source data' },
        { name: 'suppliers', description: 'Supplier list and spend' },
      ],
    },
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness and database connectivity',
      },
    },
    async (_request, reply) => {
      try {
        // Checks the dependency, not just the process. A server that answers
        // while its database is unreachable is a worse outcome than a red
        // health check, because nothing downstream notices.
        const { rows } = await getPool().query<{ loaded: number }>(
          'select count(*)::int as loaded from fuel_deliveries',
        );
        return {
          status: 'ok',
          database: 'connected',
          fuelDeliveriesLoaded: rows[0]?.loaded ?? 0,
        };
      } catch (error) {
        return reply.code(503).send({
          status: 'degraded',
          database: 'unreachable',
          message: error instanceof Error ? error.message : String(error),
          hint: 'Is Postgres running? npm run db:up && npm run etl',
        });
      }
    },
  );

  app.register(emissionsRoutes);
  app.register(incidentRoutes);
  app.register(dataQualityRoutes);
  app.register(supplierRoutes);

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({
      error: 'not_found',
      message: `No route for ${request.method} ${request.url}`,
      hint: 'See /docs for the available endpoints.',
    }),
  );

  return app;
}
