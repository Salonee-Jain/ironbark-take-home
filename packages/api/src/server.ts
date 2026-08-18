import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerErrorHandler } from './middlewares/errorHandler.js';
import { registerNotFoundHandler } from './middlewares/notFound.js';
import { registerRequestTiming } from './middlewares/requestTiming.js';
import { registerRoutes } from './routes/index.js';

/**
 * Composition root.
 *
 * Layering, outermost in:
 *
 *   routes/        path, schema, and which controller handles it. No logic.
 *   controllers/   the HTTP boundary — read the request, call a service.
 *   services/      business rules, shaping, and the judgements that are not
 *                  the database's to make.
 *   repositories/  every SQL statement, and the only place that touches the
 *                  connection pool.
 *   middlewares/   cross-cutting concerns: errors, 404s, timing.
 *
 * The layering earns its place mainly at the repository seam. Emissions
 * arithmetic lives in SQL views precisely so it is reviewable, which makes the
 * queries the part most worth isolating — they can be read as a set, and a
 * service can be tested against a stub without a database.
 *
 * Built without listening so the step 8 integration tests can drive it through
 * app.inject(): no port, no socket, no teardown races.
 */
export function buildServer(
  options: { logger?: boolean } = {},
): FastifyInstance {
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
        {
          name: 'data quality',
          description: 'What was wrong with the source data, and what we did',
        },
        { name: 'suppliers', description: 'Supplier list and spend' },
        { name: 'health', description: 'Liveness' },
      ],
    },
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  registerRequestTiming(app);
  registerErrorHandler(app);
  registerNotFoundHandler(app);

  app.register(registerRoutes);

  return app;
}
