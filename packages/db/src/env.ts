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

/** Load the root .env once. Real environment variables always win. */
function loadEnvFile(): void {
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
  loadEnvFile();

  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        '  Run `cp .env.example .env` in the repo root, then `npm run db:up`.',
    );
  }
  return url;
}
