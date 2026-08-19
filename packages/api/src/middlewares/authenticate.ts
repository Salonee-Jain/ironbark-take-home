import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { SESSION_COOKIE, type SessionClaims } from '../auth/session.js';

/**
 * The preHandler that turns a cookie into a tenant.
 *
 * Registered as a decorator rather than a global hook on purpose. A global hook
 * would make every route authenticated by default, which sounds safer and is
 * not: `/health` and `/docs` have to stay open, so the list of exemptions would
 * live *inside* this file, and adding a public route would mean editing the
 * authentication middleware. Opting in per route group keeps the decision next
 * to the route, where a reviewer reading `uploads.routes.ts` can see it.
 *
 * What this guarantees to everything downstream: `request.session.companyId` is
 * a company that exists, and is the only company this request may read or
 * write. Handlers never take a company from the path, the query or the body —
 * a tenant identifier a caller can type is a tenant identifier a caller can
 * change.
 */

export class UnauthenticatedError extends AppError {
  constructor() {
    super(
      401,
      'unauthenticated',
      'You are not signed in.',
      'Sign in at /api/auth/login. The session is an httpOnly cookie; send credentials with the request.',
    );
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, hint?: string) {
    super(403, 'forbidden', message, hint);
  }
}

export function registerAuthentication(app: FastifyInstance): void {
  app.decorate(
    'authenticate',
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      const token = request.cookies[SESSION_COOKIE];
      if (!token) throw new UnauthenticatedError();

      try {
        request.session = await request.jwtVerify<SessionClaims>({
          onlyCookie: true,
        });
      } catch {
        // Expired, tampered with, or signed by a previous process's ephemeral
        // development secret. All three mean the same thing to the caller, and
        // saying which would help only someone probing the difference.
        throw new UnauthenticatedError();
      }
    },
  );

  app.decorate(
    'requireOwner',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await app.authenticate(request, reply);
      if (request.session?.role !== 'owner') {
        throw new ForbiddenError(
          'Only a company owner can replace the dataset.',
          'Ask whoever created this company account to run the upload.',
        );
      }
    },
  );
}

/**
 * The company for this request.
 *
 * A function rather than reading `request.session!.companyId` at each call
 * site: the non-null assertion would be repeated a dozen times, and one of them
 * would eventually sit on a route that forgot its preHandler and silently read
 * `undefined` — which in a `where company_id = $1` is not an error, it is an
 * empty dashboard nobody can explain.
 */
export function companyIdOf(request: FastifyRequest): number {
  const companyId = request.session?.companyId;
  if (companyId === undefined) throw new UnauthenticatedError();
  return companyId;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireOwner: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    session?: SessionClaims;
  }
}
