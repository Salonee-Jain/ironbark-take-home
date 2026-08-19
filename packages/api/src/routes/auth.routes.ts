import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  cookieOptions,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type SessionClaims,
} from '../auth/session.js';
import { errorResponse } from '../schemas/common.schema.js';
import * as service from '../services/auth.service.js';

/**
 * Sign-up, sign-in, sign-out, and "who am I".
 *
 * The only route group that writes a cookie, which is why the session plumbing
 * is here rather than in the service: `auth.service` decides *whether* someone
 * is who they claim, and this file decides how that answer is carried on the
 * wire. Swapping the cookie for a bearer header would touch this file and
 * nothing else.
 */

const profileResponse = {
  type: 'object',
  properties: {
    user: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        email: { type: 'string' },
        displayName: { type: 'string' },
        role: { type: 'string', enum: ['owner', 'member'] },
      },
    },
    company: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        slug: { type: 'string' },
        name: { type: 'string' },
        abn: { type: 'string', nullable: true },
      },
    },
  },
} as const;

type SignupBody = {
  companyName: string;
  abn?: string;
  displayName: string;
  email: string;
  password: string;
};

type LoginBody = { email: string; password: string };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Issue the session cookie. Shared by signup and login so they cannot drift. */
  function startSession(reply: FastifyReply, claims: SessionClaims): void {
    const token = app.jwt.sign(claims, { expiresIn: SESSION_TTL_SECONDS });
    reply.setCookie(SESSION_COOKIE, token, cookieOptions());
  }

  app.post<{ Body: SignupBody }>(
    '/api/auth/signup',
    {
      schema: {
        tags: ['auth'],
        summary: 'Register a company and its first user',
        description:
          'Creates the company and an owner account for it in one transaction, then signs that user ' +
          'in. The new company starts with no data: emissions, incidents and data-quality endpoints ' +
          'return empty until a dataset is uploaded.',
        body: {
          type: 'object',
          required: ['companyName', 'displayName', 'email', 'password'],
          additionalProperties: false,
          properties: {
            companyName: { type: 'string', minLength: 2, maxLength: 120 },
            abn: {
              type: 'string',
              description: '11 digits, or omitted. Never inferred.',
            },
            displayName: { type: 'string', minLength: 2, maxLength: 120 },
            email: { type: 'string', format: 'email', maxLength: 254 },
            password: { type: 'string', minLength: 10, maxLength: 200 },
          },
        },
        response: { 400: errorResponse, 409: errorResponse },
      },
    },
    async (request, reply) => {
      const { claims, profile } = await service.signup(request.body);
      startSession(reply, claims);
      return reply.code(201).send(profile);
    },
  );

  app.post<{ Body: LoginBody }>(
    '/api/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Sign in',
        description:
          'Returns 401 with an identical message whether the email is unknown or the password is ' +
          'wrong, and takes the same time in both cases. Sets an httpOnly session cookie.',
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', maxLength: 254 },
            password: { type: 'string', maxLength: 200 },
          },
        },
        response: { 200: profileResponse, 401: errorResponse },
      },
    },
    async (request, reply) => {
      const { claims, profile } = await service.login(request.body);
      startSession(reply, claims);
      return profile;
    },
  );

  app.post(
    '/api/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Sign out',
        description:
          'Clears the session cookie. The JWT itself remains valid until it expires — there is no ' +
          'server-side revocation list, which is the accepted trade-off of stateless sessions and is ' +
          'stated here rather than implied.',
      },
    },
    async (_request, reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { signedOut: true };
    },
  );

  app.get(
    '/api/auth/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'The signed-in user and their company',
        description:
          'Read from the database rather than decoded from the token, so a renamed company or a ' +
          'changed role is reflected immediately. Also reports whether the company has any data ' +
          'loaded, so the UI can tell "no emissions" apart from "nothing uploaded yet".',
        response: { 401: errorResponse },
      },
    },
    (request) => service.getProfile(Number(request.session!.sub)),
  );
}
