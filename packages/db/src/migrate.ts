/**
 * Migration runner. Applies every .sql file in migrations/ in filename order,
 * once, inside a transaction, and records a checksum of what it ran.
 *
 * Hand-rolled rather than pulled from an ORM: the schema is the part of this
 * project a reviewer is most likely to read, and plain SQL reads better than a
 * generated DSL.
 *
 *   npm run db:migrate              apply pending migrations
 *   npm run db:migrate -- --status  show what has and has not been applied
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { closePool, withClient } from './pool.js';

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

type AppliedMigration = { filename: string; checksum: string };

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      filename     text primary key,
      checksum     text not null,
      applied_at   timestamptz not null default now(),
      duration_ms  integer not null
    )
  `);
}

async function readMigrations(): Promise<{ filename: string; sql: string }[]> {
  const entries = await readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  return Promise.all(
    files.map(async (filename) => ({
      filename,
      sql: await readFile(join(migrationsDir, filename), 'utf8'),
    })),
  );
}

/**
 * Refuse to run if an already-applied file has been edited.
 *
 * Editing a migration that has run means the database and the repo have quietly
 * diverged, and every environment that applied the old version is now wrong in
 * a way nothing will report. Better to fail here with instructions.
 */
function assertUnchanged(
  migrations: { filename: string; sql: string }[],
  applied: Map<string, string>,
): void {
  for (const { filename, sql } of migrations) {
    const previous = applied.get(filename);
    if (previous && previous !== checksum(sql)) {
      throw new Error(
        `${filename} has changed since it was applied.\n` +
          '  Migrations are immutable once run. Either add a new migration, or\n' +
          '  rebuild the database from scratch: npm run db:reset && npm run db:up && npm run db:migrate',
      );
    }
  }
}

async function status(): Promise<void> {
  await withClient(async (client) => {
    await ensureMigrationsTable(client);
    const { rows } = await client.query<AppliedMigration>(
      'select filename, checksum from schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));
    const migrations = await readMigrations();

    for (const { filename, sql } of migrations) {
      const previous = applied.get(filename);
      const mark = !previous
        ? 'pending'
        : previous === checksum(sql)
          ? 'applied'
          : 'CHANGED';
      console.log(`  ${mark.padEnd(8)} ${filename}`);
    }
  });
}

async function migrate(): Promise<void> {
  const migrations = await readMigrations();
  if (migrations.length === 0) {
    console.log('no migrations found');
    return;
  }

  await withClient(async (client) => {
    await ensureMigrationsTable(client);

    const { rows } = await client.query<AppliedMigration>(
      'select filename, checksum from schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    assertUnchanged(migrations, applied);

    const pending = migrations.filter((m) => !applied.has(m.filename));
    if (pending.length === 0) {
      console.log(`up to date (${applied.size} migrations applied)`);
      return;
    }

    for (const { filename, sql } of pending) {
      const startedAt = process.hrtime.bigint();
      // Each migration is its own transaction: a failure leaves the ones before
      // it applied, so a rerun picks up exactly where it stopped.
      await client.query('begin');
      try {
        await client.query(sql);
        const durationMs = Number(
          (process.hrtime.bigint() - startedAt) / 1_000_000n,
        );
        await client.query(
          'insert into schema_migrations (filename, checksum, duration_ms) values ($1, $2, $3)',
          [filename, checksum(sql), durationMs],
        );
        await client.query('commit');
        console.log(`  applied  ${filename} (${durationMs}ms)`);
      } catch (error) {
        await client.query('rollback');
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${filename} failed and was rolled back:\n  ${message}`);
      }
    }

    console.log(`\n${pending.length} migration(s) applied`);
  });
}

try {
  if (process.argv.includes('--status')) {
    await status();
  } else {
    await migrate();
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}
