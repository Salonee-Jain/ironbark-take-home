import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Where to look for the .env file.
 *
 * The module's own location first, so a script run from inside a workspace
 * finds the root file, then the working directory. The module URL is read
 * defensively because it does not survive bundling: a deployed build compiles
 * this into a single file where `import.meta.url` can be undefined, and a
 * loader that threw there would take the whole API down at import time for the
 * sake of a file the platform does not use anyway.
 */
function repoRootCandidates(): string[] {
  const candidates: string[] = [];
  try {
    const url = import.meta.url;
    if (url) candidates.push(resolve(dirname(fileURLToPath(url)), '../../..'));
  } catch {
    // Bundled, or otherwise without a module URL. The cwd fallback covers it.
  }
  candidates.push(process.cwd());
  return candidates;
}

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

  for (const root of repoRootCandidates()) {
    const envPath = resolve(root, '.env');
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath, quiet: true });
      return;
    }
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
