import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { SESSION_COOKIE, type SessionClaims } from '../auth/session.js';

/**
 * The preHandler that turns a cookie into a tenant.
 *
 * A decorator rather than a global hook. A global hook would need its list of
 * exemptions (/health, the docs) inside this file, so adding a public route would
 * mean editing the authentication middleware. Opting in per route group keeps
 * the decision next to the route.
 *
 * What it guarantees downstream: request.session.companyId is a company that
 * exists and is the only company this request may touch. Handlers never take a
 * company from the path, the query or the body.
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
 * The company for this request. A function rather than a non-null assertion at a
 * dozen call sites: one of them would eventually sit on a route that forgot its
 * preHandler, and `where company_id = undefined` is not an error, it is an empty
 * dashboard nobody can explain.
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
