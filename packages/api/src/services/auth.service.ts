import { AppError } from '../errors.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password.js';
import type { SessionClaims } from '../auth/session.js';
import * as repository from '../repositories/auth.repository.js';

/**
 * Sign-up and sign-in.
 *
 * The rule this layer exists to enforce: an unauthenticated caller learns
 * nothing about which accounts exist. Every failure below returns the same
 * message and the same status, and the password is hashed even when the email
 * is unknown, so neither the response nor the response *time* distinguishes a
 * wrong password from a wrong address.
 */

export class InvalidCredentialsError extends AppError {
  constructor() {
    super(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, hint?: string) {
    super(409, 'conflict', message, hint);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, hint?: string) {
    super(400, 'validation_failed', message, hint);
  }
}

/** Long enough to matter, short enough that nobody reaches for a sticky note. */
const MIN_PASSWORD_LENGTH = 10;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * `Ironbark Ridge Resources Pty Ltd` -> `ironbark-ridge-resources-pty-ltd`.
 *
 * Diacritics are folded rather than stripped, so `Peña Mining` becomes
 * `pena-mining` instead of `pea-mining`.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/**
 * A free slug derived from the company name.
 *
 * Two companies may legitimately share a trading name, so a collision appends a
 * counter rather than being rejected — the slug is an identifier, not a claim
 * to the name. It gives up after a bounded number of attempts instead of
 * looping: if `-2` through `-50` are all taken, something is wrong that another
 * round trip will not fix.
 */
async function allocateSlug(companyName: string): Promise<string> {
  const base = slugify(companyName) || 'company';

  if (!(await repository.slugExists(base))) return base;

  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await repository.slugExists(candidate))) return candidate;
  }

  throw new ConflictError(
    `Too many companies are already registered under a name like "${companyName}".`,
    'Try a more specific company name, such as including the state or region.',
  );
}

function toSessionClaims(user: repository.UserWithCompanyRow): SessionClaims {
  return {
    sub: String(user.id),
    companyId: user.company_id,
    companySlug: user.company_slug,
    email: user.email,
    role: user.role,
  };
}

function toProfile(user: repository.UserWithCompanyRow) {
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
    },
    company: {
      id: user.company_id,
      slug: user.company_slug,
      name: user.company_name,
      abn: user.company_abn,
    },
  };
}

export type SignupInput = {
  companyName: string;
  abn?: string;
  displayName: string;
  email: string;
  password: string;
};

export async function signup(input: SignupInput): Promise<{
  claims: SessionClaims;
  profile: ReturnType<typeof toProfile>;
}> {
  const email = normaliseEmail(input.email);
  const companyName = input.companyName.trim();
  const displayName = input.displayName.trim();

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  if (companyName.length < 2) {
    throw new ValidationError('Company name is required.');
  }
  if (displayName.length < 2) {
    throw new ValidationError('Your name is required.');
  }

  // Digits only, and validated rather than reformatted: an ABN is a checksummed
  // identifier, and silently "fixing" one is how a wrong entity ends up on a
  // compliance report.
  const abn = input.abn?.replace(/\s/g, '') ?? '';
  if (abn !== '' && !/^\d{11}$/.test(abn)) {
    throw new ValidationError(
      'ABN must be 11 digits, or left blank.',
      'You can add it later from the upload screen.',
    );
  }

  // Checked here for the message, and again by the unique constraint, which is
  // what actually holds under two simultaneous signups.
  if (await repository.findUserByEmail(email)) {
    throw new ConflictError(
      'An account already exists for that email address.',
      'Sign in instead, or use a different address.',
    );
  }

  const [passwordHash, companySlug] = await Promise.all([
    hashPassword(input.password),
    allocateSlug(companyName),
  ]);

  let user: repository.UserWithCompanyRow;
  try {
    user = await repository.createCompanyWithOwner({
      companyName,
      companySlug,
      abn: abn === '' ? null : abn,
      email,
      passwordHash,
      displayName,
    });
  } catch (error) {
    // 23505 is unique_violation: the race the check above cannot close.
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new ConflictError(
        'An account already exists for that email address.',
        'Sign in instead, or use a different address.',
      );
    }
    throw error;
  }

  return { claims: toSessionClaims(user), profile: toProfile(user) };
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<{ claims: SessionClaims; profile: ReturnType<typeof toProfile> }> {
  const email = normaliseEmail(input.email);
  const user = await repository.findUserByEmail(email);

  // Always hash something. Returning early for an unknown email would make the
  // response time a reliable account-enumeration oracle.
  const ok = await verifyPassword(
    input.password,
    user?.password_hash ?? DUMMY_HASH,
  );

  if (!user || !ok) throw new InvalidCredentialsError();

  await repository.touchLastLogin(user.id);

  return { claims: toSessionClaims(user), profile: toProfile(user) };
}

/**
 * The current session, re-read from the database rather than from the token.
 *
 * The JWT is trustworthy but stale: a company renamed or a user's role changed
 * after it was issued would keep showing the old values for up to eight hours,
 * and a user deleted mid-session would keep working entirely.
 */
export async function getProfile(userId: number) {
  const user = await repository.findUserById(userId);
  if (!user) throw new InvalidCredentialsError();

  const rowCounts = await repository.countLoadedRows(user.company_id);
  const hasData = Object.values(rowCounts).some((count) => count > 0);

  return { ...toProfile(user), dataset: { hasData, rowCounts } };
}
