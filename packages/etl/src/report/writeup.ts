/**
 * Regenerates the data-quality tables in WRITEUP.md.
 *
 *   npm run writeup
 *
 * The write-up makes claims about the source data — 22 rules, 99 findings,
 * seven duplicate invoices — and a hand-typed table making those claims starts
 * drifting from the code the first time a rule changes. Nobody notices, because
 * prose does not fail a build. So the tables are generated from the same
 * loaders the ETL runs, against the same files, and the check below fails if
 * the committed document no longer matches.
 *
 * Deliberately reads `data/raw/` rather than the database: the numbers belong
 * to the export, not to whatever happens to be loaded locally, and a document
 * should be regenerable on a laptop with no Docker running.
 *
 *   npm run writeup -- --check   verify without writing (used by CI)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv } from '../csv.js';
import { IssueCollector, type DataQualityIssue } from '../issues.js';
import { loadElectricityReadings } from '../load/electricity.js';
import { loadFuelDeliveries } from '../load/fuel.js';
import { loadIncidents } from '../load/incidents.js';
import { loadSuppliers } from '../load/suppliers.js';
import { ALL_RULES } from '../rules.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const WRITEUP_PATH = join(repoRoot, 'WRITEUP.md');
const raw = (name: string) => join(repoRoot, 'data', 'raw', name);

const BEGIN = '<!-- BEGIN GENERATED: data-quality -->';
const END = '<!-- END GENERATED: data-quality -->';

function collectIssues(): readonly DataQualityIssue[] {
  const issues = new IssueCollector();
  loadFuelDeliveries(readCsv(raw('fuel_deliveries.csv')), issues);
  loadElectricityReadings(readCsv(raw('electricity_meter_readings.csv')), issues);
  loadIncidents(readCsv(raw('incident_register.csv')), issues);
  loadSuppliers(readCsv(raw('suppliers.csv')), issues);
  return issues.all();
}

/** Markdown tables break on an unescaped pipe. */
const cell = (text: string) => text.replace(/\|/g, '\\|');

/**
 * The rationale is written for a compliance reviewer and runs to several
 * sentences; the full text lives in the rule catalogue, which the API serves at
 * /api/data-quality/rules.
 *
 * The table carries enough of it to stand on its own. One sentence is not
 * reliably enough — several rationales open with a short definition ("An ABN is
 * 11 digits.") that says nothing about what was found — so sentences are taken
 * until the summary carries some substance, capped at two so the table stays
 * readable.
 */
const SUMMARY_MIN_CHARS = 110;

function summarise(text: string): string {
  // A sentence ends at a terminator followed by whitespace or end-of-string.
  // Splitting on the terminator alone truncates mid-number — the rationale for
  // FUEL-FORMAT-01 quotes `132182.58`, which is one sentence, not two.
  const sentences = text.match(/.*?[.!?](?=\s|$)/gs) ?? [text];

  let summary = '';
  for (const sentence of sentences.slice(0, 2)) {
    summary += sentence;
    if (summary.trim().length >= SUMMARY_MIN_CHARS) break;
  }
  return summary.trim();
}

function render(issues: readonly DataQualityIssue[]): string {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.ruleId, (counts.get(issue.ruleId) ?? 0) + 1);
  }

  const fired = ALL_RULES.filter((rule) => counts.has(rule.ruleId)).sort((a, b) =>
    a.sourceFile === b.sourceFile
      ? a.ruleId.localeCompare(b.ruleId)
      : a.sourceFile.localeCompare(b.sourceFile),
  );

  const byAction = (action: string) =>
    issues.filter((issue) => issue.action === action).length;
  const bySeverity = (severity: string) =>
    issues.filter((issue) => issue.severity === severity).length;

  const lines: string[] = [];

  lines.push(
    `**${issues.length} findings across ${fired.length} rules.** ` +
      `By action: ${byAction('fixed')} fixed, ${byAction('flagged')} flagged, ` +
      `${byAction('rejected')} rejected. ` +
      `By severity: ${bySeverity('error')} error, ${bySeverity('warning')} warning, ` +
      `${bySeverity('info')} info.`,
    '',
  );

  let currentFile = '';
  for (const rule of fired) {
    if (rule.sourceFile !== currentFile) {
      currentFile = rule.sourceFile;
      lines.push('', `#### \`${currentFile}\``, '');
      lines.push('| Rule | What was wrong | n | Action | Why |');
      lines.push('|---|---|---:|---|---|');
    }
    lines.push(
      `| \`${rule.ruleId}\` | ${cell(rule.title)} | ${counts.get(rule.ruleId)} ` +
        `| **${rule.defaultAction}** | ${cell(summarise(rule.rationale))} |`,
    );
  }

  const unfired = ALL_RULES.filter((rule) => !counts.has(rule.ruleId));
  if (unfired.length > 0) {
    lines.push(
      '',
      `A further ${unfired.length} rules are implemented and did not fire on this export ` +
        `(${unfired.map((r) => `\`${r.ruleId}\``).join(', ')}). They guard against values ` +
        'this file happens not to contain, and are covered by fixtures in ' +
        '`packages/etl/src/load/defensiveRules.test.ts` so that "silent" stays ' +
        'distinguishable from "broken".',
    );
  }

  return lines.join('\n');
}

function main(): void {
  const check = process.argv.includes('--check');
  const document = readFileSync(WRITEUP_PATH, 'utf8');

  const start = document.indexOf(BEGIN);
  const end = document.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(
      `WRITEUP.md is missing the generated block markers.\n  Expected ${BEGIN} ... ${END}`,
    );
  }

  const generated = render(collectIssues());
  const updated =
    document.slice(0, start + BEGIN.length) +
    `\n\n${generated}\n\n` +
    document.slice(end);

  if (updated === document) {
    console.log('WRITEUP.md is up to date.');
    return;
  }

  if (check) {
    throw new Error(
      'WRITEUP.md is out of date with the rule engine. Run `npm run writeup` and commit the result.',
    );
  }

  writeFileSync(WRITEUP_PATH, updated, 'utf8');
  console.log('Updated the generated section of WRITEUP.md.');
}

try {
  main();
} catch (error) {
  console.error(
    `\n${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
