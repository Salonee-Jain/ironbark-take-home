import { randomBytes } from 'node:crypto';

/**
 * Session configuration.
 *
 * The token is a JWT in an httpOnly cookie rather than a bearer token in
 * localStorage: anything readable by a script on the page is readable by any
 * script that gets onto the page, and a stolen token here is a stolen copy of a
 * client's operational data.
 *
 * The cost of a cookie is CSRF, paid with sameSite strict plus a CORS allowlist.
 * The dev frontend goes through Vite's proxy, so browser and API share an origin
 * and a strict cookie is sent normally.
 */

export const SESSION_COOKIE = 'ironbark_session';

/** Eight hours: a working day, then sign in again. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export type SessionClaims = {
  /** Subject: the user id, as a string, per JWT convention. */
  sub: string;
  companyId: number;
  companySlug: string;
  email: string;
  role: 'owner' | 'member';
};

/**
 * The signing secret. Required in production and refused if left at a
 * placeholder: a signing key that ships in a repository is a public statement
 * that anyone may mint a session for any company.
 *
 * In development a random secret is generated per process instead of failing, so
 * `npm run api` works from a fresh clone. Sessions then do not survive a
 * restart, which is what an ephemeral key means.
 */
export function loadJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (secret && secret.length >= 32 && !secret.startsWith('change-me')) {
    return secret;
  }

  if (isProduction) {
    throw new Error(
      'JWT_SECRET must be set to at least 32 random characters in production.\n' +
        '  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }

  if (secret) {
    console.warn(
      '[auth] JWT_SECRET is unset or still a placeholder. Using an ephemeral\n' +
        '       development secret — sessions will not survive a restart.',
    );
  }

  return randomBytes(48).toString('base64url');
}

export function cookieOptions(): {
  httpOnly: true;
  sameSite: 'strict';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'strict',
    // Secure cookies are dropped over plain http, which is what local
    // development is, so this follows the environment rather than being pinned
    // on and quietly breaking sign-in on localhost.
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}
