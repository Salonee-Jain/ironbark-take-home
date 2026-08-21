/**
 * ETL entry point.
 *
 *   npm run etl                        load into the demo tenant
 *   npm run etl -- --company <slug>    load into another tenant
 *
 * Idempotent: it replaces the tenant's own rows and reloads from source. The
 * cleaning itself lives in ingest.ts, shared with POST /api/uploads.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, withClient } from '@ironbark/db';
import {
  ingestWithClient,
  INGEST_FILES,
  type IngestInput,
  type IngestResult,
} from './ingest.js';
import { RULES } from './rules.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rawDataDir = join(repoRoot, 'data', 'raw');

/** The tenant that owns the sample export shipped with the repo. */
const DEFAULT_COMPANY_SLUG = 'ironbark-ridge';

function heading(text: string): void {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`);
}

function companySlugFromArgv(): string {
  const index = process.argv.indexOf('--company');
  return index >= 0 ? (process.argv[index + 1] ?? DEFAULT_COMPANY_SLUG) : DEFAULT_COMPANY_SLUG;
}

function readSourceFiles(): IngestInput {
  const input: IngestInput = {};
  for (const name of INGEST_FILES) {
    input[name] = readFileSync(join(rawDataDir, name), 'utf8');
  }
  return input;
}

function reportDataQuality(result: IngestResult): void {
  heading('Data quality findings');

  for (const [ruleId, count] of result.issuesByRule) {
    const rule = RULES[ruleId as keyof typeof RULES];
    console.log(
      `  ${ruleId.padEnd(26)} ${String(count).padStart(3)}  ${rule.defaultAction.padEnd(8)} ${rule.title}`,
    );
  }

  const bySeverity: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  for (const issue of result.issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    byAction[issue.action] = (byAction[issue.action] ?? 0) + 1;
  }

  console.log(
    `\n  ${result.issueCount} findings across ${result.issuesByRule.length} rules` +
      `\n  by severity: ${JSON.stringify(bySeverity)}` +
      `\n  by action:   ${JSON.stringify(byAction)}`,
  );
}

function reportAi(result: IngestResult): void {
  heading('AI incident findings');

  const ai = result.ai;
  if (!ai) {
    console.log(
      '  No cached findings at data/ai/incident_findings.json.\n' +
        '  Everything else works without them. To generate: set ANTHROPIC_API_KEY, then\n' +
        '  npm run ai:classify',
    );
    return;
  }

  console.log(`  loaded                 ${ai.loaded}`);
  console.log(`  psychosocial hazards   ${ai.psychosocial}`);
  console.log(`  severity mismatches    ${ai.severityMismatches}`);
  console.log(`  model                  ${ai.model} (${ai.promptVersion})`);

  // Loud rather than logged-and-forgotten: a cached finding failing the gate on
  // reload means the cache and the register have drifted apart.
  if (ai.rejected > 0) {
    console.log(
      `\n  WARNING: ${ai.rejected} cached finding(s) failed the grounding check against the\n` +
        '  freshly loaded descriptions and were NOT loaded. Re-run npm run ai:classify -- --force.',
    );
  }
  if (ai.skippedMissingIncident > 0) {
    console.log(
      `  ${ai.skippedMissingIncident} cached finding(s) cite incidents that no longer exist and were skipped.`,
    );
  }
}

export async function run(): Promise<void> {
  const slug = companySlugFromArgv();

  heading('Reading source files');
  const input = readSourceFiles();
  for (const name of INGEST_FILES) {
    console.log(`  ${name.padEnd(31)} ${(input[name]?.length ?? 0).toLocaleString()} bytes`);
  }

  const result = await withClient(async (client) => {
    const { rows } = await client.query<{ id: number; name: string }>(
      'select id, name from companies where slug = $1',
      [slug],
    );
    const company = rows[0];
    if (!company) {
      throw new Error(
        `No company with slug "${slug}".\n` +
          '  The demo tenant is seeded by migration 0007. Run: npm run db:migrate',
      );
    }

    console.log(`\n  loading into: ${company.name} (${slug})`);

    // One transaction for the whole load. A half-loaded database is worse than
    // an empty one because it looks like it worked.
    await client.query('begin');
    try {
      const loaded = await ingestWithClient(client, company.id, input);
      await client.query(
        `insert into data_loads (company_id, source, files, row_counts, issue_count, error_count, finished_at)
         values ($1, 'cli', $2, $3, $4, $5, now())`,
        [
          company.id,
          JSON.stringify(
            INGEST_FILES.map((name) => ({
              name,
              bytes: input[name]?.length ?? 0,
            })),
          ),
          JSON.stringify(loaded.rowCounts),
          loaded.issueCount,
          loaded.errorCount,
        ],
      );
      await client.query('commit');
      return loaded;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });

  reportDataQuality(result);

  heading('Loaded into Postgres');
  for (const [table, count] of Object.entries(result.rowCounts)) {
    console.log(`  ${table.padEnd(22)} ${String(count).padStart(5)}`);
  }

  reportAi(result);

  console.log('\nLoad complete.\n');
}

try {
  await run();
} catch (error) {
  console.error(
    `\nETL failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await closePool();
}
