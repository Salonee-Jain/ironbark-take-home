import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * The repo root, four levels up from this file at packages/db/src/env.ts.
 * Resolved from the module URL rather than process.cwd() so the loader works
 * the same whether a script is run from the root or from inside a workspace.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let loaded = false;

/**
 * Load the root .env once. Real environment variables always win.
 *
 * Exported because it is no longer only the database that needs it: the API
 * reads JWT_SECRET at startup, and it does so before anything has touched the
 * connection pool. Left implicit, the secret would silently be absent and every
 * restart would invalidate every session for a reason nobody could see.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const envPath = resolve(repoRoot, '.env');
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
  }
}

/**
 * Read DATABASE_URL, failing loudly with the fix rather than letting a
 * connection attempt time out against a default nobody configured.
 */
export function loadDatabaseUrl(): string {
  loadEnv();

  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        '  Run `cp .env.example .env` in the repo root, then `npm run db:up`.',
    );
  }
  return url;
}
