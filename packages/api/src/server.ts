import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadEnv } from '@ironbark/db';
import { loadJwtSecret, SESSION_COOKIE } from './auth/session.js';
import { registerAuthentication } from './middlewares/authenticate.js';
import { registerErrorHandler } from './middlewares/errorHandler.js';
import { registerNotFoundHandler } from './middlewares/notFound.js';
import { registerRequestTiming } from './middlewares/requestTiming.js';
import { registerRoutes } from './routes/index.js';

/**
 * Composition root.
 *
 * Layering, outermost in:
 *
 *   routes/        path, validation schema, and the service call behind it.
 *                  The handler is a single expression mapping request onto a
 *                  service argument; anything more belongs in the service.
 *   services/      business rules, shaping, and the judgements that are not
 *                  the database's to make.
 *   repositories/  every SQL statement, and the only place that touches the
 *                  connection pool.
 *   middlewares/   cross-cutting concerns: errors, 404s, timing.
 *
 * There is still no controller layer. For read-only endpoints a controller had
 * nothing to do but forward its arguments to a service, and a file of functions
 * that only forward arguments is the ceremony that gives layered architecture a
 * bad name. The exception this file predicted has since arrived —
 * `uploads.routes.ts` does real request handling: multipart parts, a role per
 * field, an owner-only guard. It does that work in the route rather than
 * growing a controller layer for one endpoint.
 *
 * **Tenancy.** Every route except `/health`, `/docs` and `/api/auth/*` runs
 * behind `app.authenticate`, and reads its company from the verified session
 * cookie. No endpoint accepts a company identifier from the caller.
 *
 * The seam that genuinely earns its place is the repository. Emissions
 * arithmetic lives in SQL views precisely so it is reviewable, which makes the
 * queries the part most worth isolating — they can be read as a set, and a
 * service can be tested against a stub without a database.
 *
 * Built without listening so the step 8 integration tests can drive it through
 * app.inject(): no port, no socket, no teardown races.
 */
/**
 * Origins allowed to send credentialed requests.
 *
 * The Vite dev server by default; anything else has to be named explicitly in
 * CORS_ORIGINS. Reflecting the caller's own Origin — the previous `origin: true`
 * — stops being merely permissive once cookies are involved and becomes a way
 * for any site to act as a signed-in user.
 */
function corsOrigins(): string[] {
  const configured = process.env['CORS_ORIGINS'];
  if (configured) {
    return configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174'];
}

export function buildServer(
  options: { logger?: boolean } = {},
): FastifyInstance {
  // Before anything reads process.env. The pool loads the .env lazily on first
  // connect, which is too late for a secret needed at registration time.
  loadEnv();

  const app = Fastify({
    logger: options.logger ?? false,
    // Query strings arrive as strings; without coercion `severity=2` fails an
    // integer schema and `psychosocial=true` never matches a boolean.
    ajv: { customOptions: { coerceTypes: true } },
  });

  // ---- session plumbing, registered before the routes that depend on it ----
  //
  // Order matters: @fastify/jwt reads the token out of a cookie, so
  // @fastify/cookie has to have parsed one first.
  app.register(cookie);
  app.register(jwt, {
    secret: loadJwtSecret(),
    cookie: { cookieName: SESSION_COOKIE, signed: false },
  });

  app.register(multipart, {
    limits: {
      // The five source files together are well under a megabyte. Five
      // megabytes each leaves generous room for a real client's export while
      // still refusing the accidental 200MB database dump.
      fileSize: 5 * 1024 * 1024,
      files: 5,
      fields: 10,
    },
  });

  // Credentials must be allowed for the session cookie to travel, and `origin:
  // true` reflects whatever Origin the caller sent — which, combined with
  // credentials, would let any site on the internet make authenticated requests
  // on a signed-in user's behalf. The allowlist is the fix. In development the
  // frontend goes through Vite's proxy and is same-origin anyway, so this only
  // matters for a deployment that splits the two.
  app.register(cors, {
    origin: corsOrigins(),
    credentials: true,
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'Ironbark Ridge API',
        description:
          'Emissions, safety and data-quality intelligence for heavy industry. Every figure is ' +
          'computed from cleaned source records; every AI finding cites the record it came from.\n\n' +
          'Multi-tenant: a company signs up, uploads its own export, and sees only its own data. ' +
          'Endpoints outside /api/auth require the session cookie set by /api/auth/login, and take ' +
          'the company from that session rather than from any parameter.',
        version: '0.1.0',
      },
      tags: [
        { name: 'auth', description: 'Sign-up, sign-in, and the current session' },
        { name: 'uploads', description: 'Replacing a company dataset' },
        { name: 'emissions', description: 'Scope 1 and Scope 2' },
        { name: 'incidents', description: 'Safety register and trends' },
        {
          name: 'data quality',
          description: 'What was wrong with the source data, and what we did',
        },
        { name: 'suppliers', description: 'Supplier list and spend' },
        {
          name: 'analysis',
          description: 'Findings that need more than one dataset to see',
        },
        {
          name: 'reports',
          description: 'AI compliance summary, with a citation on every claim',
        },
        { name: 'health', description: 'Liveness' },
      ],
    },
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  registerRequestTiming(app);
  registerAuthentication(app);
  registerErrorHandler(app);
  registerNotFoundHandler(app);

  app.register(registerRoutes);

  return app;
}
