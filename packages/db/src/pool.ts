import pg from 'pg';
import { loadDatabaseUrl } from './env.js';

const { Pool } = pg;

/**
 * Two `pg` defaults would quietly corrupt what this project reports, so both are
 * overridden here, where every consumer inherits the fix.
 *
 * DATE is parsed into a JS Date at local midnight, so `2026-03-01` read in
 * Brisbane and printed in UTC becomes February, shifting every month bucket.
 * Dates stay strings.
 *
 * NUMERIC is returned as a string, because Postgres numerics can exceed a
 * double. Left alone, kg_co2e arrives as "1893.90" and every chart silently
 * plots nothing. The largest value this schema holds is under 1e12, well inside
 * what a double represents exactly, so parsing is safe here.
 */
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) =>
  Number(value),
);
// int8 (count(*), sum of integers) has the same string-return behaviour.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) =>
  Number(value),
);

let pool: pg.Pool | undefined;

/**
 * Lazily created singleton pool.
 *
 * Lazy because importing this module must not open sockets, the unit tests in
 * step 8 import the normalisers from packages that transitively touch this, and
 * they have no database.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: loadDatabaseUrl(),
      // A local Docker container either answers immediately or is not running.
      // Fail fast instead of hanging the ETL for 30 seconds.
      connectionTimeoutMillis: 10_000,
      // Ten is right for a long-lived process holding one pool. A serverless
      // deployment runs many short-lived instances against a database with its
      // own connection ceiling, so the ceiling is per instance and configurable.
      max: Number(process.env['PGPOOL_MAX'] ?? (process.env['VERCEL'] ? 3 : 10)),
      // Serverless instances are frozen between requests; an idle client held
      // open across that gap is a connection the database counts and nobody is
      // using.
      idleTimeoutMillis: process.env['VERCEL'] ? 10_000 : 30_000,
    });

    // Without a listener, an idle client erroring out takes the process down.
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pool;
}

/** Run a function with a dedicated client, always releasing it. */
export async function withClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
