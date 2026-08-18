import pg from 'pg';
import { loadDatabaseUrl } from './env.js';

const { Pool } = pg;

/**
 * Two `pg` defaults would quietly corrupt everything this project reports, so
 * they are overridden once, here, where every consumer inherits the fix.
 *
 * DATE (oid 1082) is parsed into a JS `Date` by default — local midnight. Read
 * `2026-03-01` in Brisbane and print it in UTC and you get February. Every
 * month bucket in the app would shift by one for anyone west of Greenwich.
 * Dates stay strings, consistent with how the ETL treats them.
 *
 * NUMERIC (oid 1700) is returned as a *string*, because Postgres numerics can
 * exceed what a double can represent. Left alone, `kg_co2e` arrives as "1893.90"
 * and JSON-serialises as a quoted string, so every chart silently plots nothing
 * — or worse, string-concatenates a total. The largest value this schema can
 * hold is under 1e12, well inside the 2^53 range a double represents exactly,
 * so parsing to a number is safe here. It would not be for a ledger in cents at
 * national scale, which is why this is a considered override and not a default.
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
 * Lazy because importing this module must not open sockets — the unit tests in
 * step 8 import the normalisers from packages that transitively touch this, and
 * they have no database.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: loadDatabaseUrl(),
      // A local Docker container either answers immediately or is not running.
      // Fail fast instead of hanging the ETL for 30 seconds.
      connectionTimeoutMillis: 5_000,
      max: 10,
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
