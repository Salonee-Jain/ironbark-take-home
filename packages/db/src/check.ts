/**
 * Connection smoke test.
 *
 * Proves the host can reach Postgres with the credentials in .env — which is
 * where the setup actually fails (port already taken, container still starting,
 * .env never copied). Run after `npm run db:up`.
 */
import { closePool, getPool } from './index.js';

type VersionRow = { version: string; database: string; now: Date };

async function main(): Promise<void> {
  const { rows } = await getPool().query<VersionRow>(
    'select version() as version, current_database() as database, now() as now',
  );

  const row = rows[0];
  if (!row) throw new Error('connected, but the server returned no rows');

  // "PostgreSQL 16.10 on aarch64-unknown-linux-musl, compiled by ..." — the
  // first two words are the useful part.
  const version = row.version.split(',')[0] ?? row.version;

  console.log(`ok  ${version}`);
  console.log(`    database: ${row.database}`);
  console.log(`    time:     ${row.now.toISOString()}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nCannot connect to Postgres.\n  ${message}\n`);

  if (message.includes('ECONNREFUSED')) {
    console.error('  Nothing is listening. Try: npm run db:up\n');
  } else if (message.includes('password authentication failed')) {
    console.error(
      '  Credentials in .env do not match the running container.\n' +
        '  If you changed them after first start: npm run db:reset && npm run db:up\n',
    );
  }
  process.exitCode = 1;
} finally {
  await closePool();
}
