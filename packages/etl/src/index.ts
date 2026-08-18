/**
 * ETL entry point.
 *
 * Reads the untouched export from `data/raw/`, normalises it, records every
 * problem it finds, and loads the result into Postgres in a single transaction.
 *
 *   npm run etl
 *
 * Idempotent: it truncates the tables it owns and reloads from source, so
 * running it twice leaves the database in the same state as running it once.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, withClient } from '@ironbark/db';
import { loadAiFindings, type AiLoadResult } from './ai/load.js';
import { IssueCollector } from './issues.js';
import { loadElectricityReadings } from './load/electricity.js';
import { loadEmissionFactors } from './load/emissionFactors.js';
import { loadFuelDeliveries } from './load/fuel.js';
import { loadIncidents } from './load/incidents.js';
import { loadSuppliers } from './load/suppliers.js';
import { RULES } from './rules.js';
import { writeLoad } from './writer.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rawDataDir = join(repoRoot, 'data', 'raw');

function heading(text: string): void {
  console.log(`\n${text}\n${'-'.repeat(text.length)}`);
}

export async function run(): Promise<void> {
  const issues = new IssueCollector();

  heading('Reading source files');

  const factors = loadEmissionFactors(join(rawDataDir, 'emission_factors.csv'));
  console.log(`  emission_factors.csv           ${factors.length} factors`);

  const fuel = loadFuelDeliveries(
    join(rawDataDir, 'fuel_deliveries.csv'),
    issues,
  );
  console.log(`  fuel_deliveries.csv            ${fuel.length} deliveries loaded`);

  const { meters, readings } = loadElectricityReadings(
    join(rawDataDir, 'electricity_meter_readings.csv'),
    issues,
  );
  console.log(
    `  electricity_meter_readings.csv ${readings.length} readings across ${meters.length} meters`,
  );

  const incidents = loadIncidents(
    join(rawDataDir, 'incident_register.csv'),
    issues,
  );
  console.log(`  incident_register.csv          ${incidents.length} incidents`);

  const suppliers = loadSuppliers(join(rawDataDir, 'suppliers.csv'), issues);
  console.log(`  suppliers.csv                  ${suppliers.length} suppliers`);

  // --- data quality summary -------------------------------------------------
  heading('Data quality findings');

  const byRule = issues.countByRule();
  const sorted = [...byRule.entries()].sort((a, b) => b[1] - a[1]);

  for (const [ruleId, count] of sorted) {
    const rule = RULES[ruleId];
    console.log(
      `  ${ruleId.padEnd(26)} ${String(count).padStart(3)}  ${rule.defaultAction.padEnd(8)} ${rule.title}`,
    );
  }

  const bySeverity = issues.countBy('severity');
  const byAction = issues.countBy('action');
  console.log(
    `\n  ${issues.all().length} findings across ${byRule.size} rules` +
      `\n  by severity: ${JSON.stringify(bySeverity)}` +
      `\n  by action:   ${JSON.stringify(byAction)}`,
  );

  // --- write ----------------------------------------------------------------
  heading('Loading into Postgres');

  // Returned from the callback rather than assigned to an outer variable:
  // TypeScript cannot see that the callback runs, and narrows such a variable
  // to `null` for the rest of the function.
  const aiResult = await withClient(async (client) => {
    let ai: AiLoadResult = null;
    // One transaction for the whole load. A half-loaded database is worse than
    // an empty one because it looks like it worked.
    await client.query('begin');
    try {
      await writeLoad(client, {
        factors,
        meters,
        readings,
        fuel,
        incidents,
        suppliers,
        issues: issues.all(),
      });

      // Inside the same transaction: the findings cite incident IDs, and a
      // database holding one without the other is not a state worth committing.
      ai = await loadAiFindings(client);

      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }

    const { rows } = await client.query<{
      table_name: string;
      row_count: string;
    }>(`
      select 'fuel_deliveries' as table_name, count(*)::text as row_count from fuel_deliveries
      union all select 'electricity_readings', count(*)::text from electricity_readings
      union all select 'incidents', count(*)::text from incidents
      union all select 'suppliers', count(*)::text from suppliers
      union all select 'emission_factors', count(*)::text from emission_factors
      union all select 'data_quality_issues', count(*)::text from data_quality_issues
      order by 1
    `);

    for (const row of rows) {
      console.log(`  ${row.table_name.padEnd(22)} ${row.row_count.padStart(5)}`);
    }

    return ai;
  });

  // --- AI findings ----------------------------------------------------------
  heading('AI incident findings');

  if (!aiResult) {
    console.log(
      '  No cached findings at data/ai/incident_findings.json.\n' +
        '  Everything else works without them. To generate: set ANTHROPIC_API_KEY, then\n' +
        '  npm run ai:classify',
    );
  } else {
    console.log(`  loaded                 ${aiResult.loaded}`);
    console.log(`  psychosocial hazards   ${aiResult.psychosocial}`);
    console.log(`  severity mismatches    ${aiResult.severityMismatches}`);
    console.log(`  model                  ${aiResult.model} (${aiResult.promptVersion})`);

    // Loud rather than logged-and-forgotten: a cached finding failing the gate
    // on reload means the cache and the register have drifted apart.
    if (aiResult.rejected > 0) {
      console.log(
        `\n  WARNING: ${aiResult.rejected} cached finding(s) failed the grounding check against the\n` +
          '  freshly loaded descriptions and were NOT loaded. Re-run npm run ai:classify -- --force.',
      );
    }
    if (aiResult.skippedMissingIncident > 0) {
      console.log(
        `  ${aiResult.skippedMissingIncident} cached finding(s) cite incidents that no longer exist and were skipped.`,
      );
    }
  }

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
