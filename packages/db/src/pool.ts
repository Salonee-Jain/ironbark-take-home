import pg from 'pg';
import { loadDatabaseUrl } from './env.js';

const { Pool } = pg;

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
