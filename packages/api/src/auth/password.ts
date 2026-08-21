import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing with scrypt from Node's own crypto rather than bcrypt or
 * argon2: both are native modules needing a toolchain at install time, and "npm
 * install failed on the reviewer's laptop" is the worse outcome.
 *
 * Parameters are the OWASP minimum (N=2^15, r=8, p=1) and are stored in the hash
 * string, so raising the cost later does not invalidate existing hashes.
 */

/**
 * `promisify` resolves to the first of scrypt's overloads, which has no options
 * parameter, so passing N/r/p is a type error even though it works at runtime.
 * The signature is restated here rather than casting at each call site.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** scrypt's block array is 128*N*r bytes; OpenSSL wants headroom above it. */
function maxmemFor(n: number, r: number): number {
  return 256 * n * r;
}

const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** `scrypt$N$r$p$salt$hash`, both blobs base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    // Node caps scrypt at 32MB of working memory by default, and N=2^15 needs
    // exactly that much for the block array alone, OpenSSL then asks for a
    // little more on top and the call throws. Room is granted explicitly rather
    // than tuning N down to fit a default nobody chose on security grounds.
    maxmem: maxmemFor(N, R),
  });

  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verify.
 *
 * Returns false for a malformed stored hash rather than throwing: a corrupt row
 * must fail the login, not 500 the endpoint and tell the caller that this
 * particular account exists.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts as [
    string, string, string, string, string, string,
  ];

  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return false;
  }

  const salt = Buffer.from(rawSalt, 'base64');
  const expected = Buffer.from(rawKey, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: maxmemFor(n, r),
  });

  // Lengths are equal by construction above, but timingSafeEqual throws rather
  // than returning false when they are not, so it is still worth the guard.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A dummy hash to verify against when the email does not exist.
 *
 * Without it, a missing account returns in microseconds and a real one takes
 * ~100ms of scrypt, which is a usable account-enumeration oracle. Verifying the
 * submitted password against this constant costs the same as a real check.
 */
export const DUMMY_HASH =
  'scrypt$32768$8$1$/6S7pXOyhulBD3OEZXa/KA==$' +
  'beAtk8f5w87dhqozn9sPPWY02tlN9bRI8qD+yLaLPguKZm381QgmwAGHl05NRE6+JIK5bDcwh8Fsq/7Bq2VQ/g==';
