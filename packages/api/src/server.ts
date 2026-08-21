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
 * Layering, outermost in: routes hold the path, the schema and one service call;
 * services hold the business rules; repositories hold every SQL statement and
 * are the only thing that touches the pool; middlewares hold errors, 404s and
 * timing. There is no controller layer, because for read-only endpoints it
 * would only forward arguments.
 *
 * Tenancy: every route except /health, the docs and /api/auth/* runs behind
 * app.authenticate and takes its company from the verified session cookie.
 *
 * Built without listening so the integration tests can drive it through
 * app.inject().
 */

/**
 * Origins allowed to send credentialed requests: the Vite dev server by default,
 * anything else named in CORS_ORIGINS. Reflecting the caller's own Origin stops
 * being merely permissive once cookies are involved.
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
  // true` reflects whatever Origin the caller sent, which, combined with
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
  // The document itself, always. Generated from the same route schemas the
  // server validates against, so it cannot describe an API this is not.
  app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());

  // The browsable UI, only where it can actually read its own files. Its assets
  // are loaded from disk relative to the installed package, which does not
  // survive being compiled into a single deployed bundle, so a serverless build
  // serves the document above and skips the viewer.
  //
  // Under /api rather than at the root because on the hosted build everything
  // outside /api is the static site, and /docs would land on the Vue app.
  if (!process.env['VERCEL']) {
    app.register(swaggerUi, { routePrefix: '/api/docs' });
  }

  registerRequestTiming(app);
  registerAuthentication(app);
  registerErrorHandler(app);
  registerNotFoundHandler(app);

  app.register(registerRoutes);

  return app;
}
