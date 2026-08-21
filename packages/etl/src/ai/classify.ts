/**
 * Incident classification.
 *
 *   npm run ai:classify                        classify anything not already cached
 *   npm run ai:classify -- --force             reclassify everything
 *   npm run ai:classify -- --provider=openai   choose the vendor for this run
 *
 * Verifies every finding against its source record and writes the survivors to a
 * cache committed to the repo. Requires ANTHROPIC_API_KEY or OPENAI_API_KEY.
 */
import { closePool, getPool, loadEnv } from '@ironbark/db';
import { writeCache, readCache, type FindingsCache } from './cache.js';
import { BatchResponseSchema } from './schema.js';
import {
  findMissing,
  verifyFindings,
  type GroundedFinding,
  type Rejection,
  type SourceIncident,
} from './grounding.js';
import {
  buildRegroundingMessage,
  buildUserMessage,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type PromptIncident,
} from './prompt.js';
import { providerFlag, resolveProvider, type ChatTurn } from './providers/index.js';

/**
 * Incidents per request. Small enough that one bad response costs little, large
 * enough that the system prompt is not re-sent 42 times.
 */
const BATCH_SIZE = 8;

/** The structured-output contract for this task, handed to whichever vendor runs. */
const OUTPUT = { name: 'incident_findings', schema: BatchResponseSchema };

type IncidentRow = {
  id: string;
  incident_date: string;
  location_raw: string;
  type_code: string;
  severity: number | null;
  description: string;
};

async function loadIncidents(): Promise<(PromptIncident & SourceIncident)[]> {
  const { rows } = await getPool().query<IncidentRow>(
    `select id, to_char(incident_date, 'YYYY-MM-DD') as incident_date,
            location_raw, type_code, severity, description
     from incidents
     order by incident_date, id`,
  );

  return rows.map((row) => ({
    id: row.id,
    incidentDate: row.incident_date,
    location: row.location_raw,
    typeCode: row.type_code,
    severity: row.severity,
    description: row.description,
  }));
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  // Explicitly, before the key is read. The pool loads the .env lazily on first
  // connect, which used to be enough because the client was constructed after
  // the incidents query, but resolving the provider first means nothing has
  // touched the database yet, and the key would look absent when it is merely
  // unloaded.
  loadEnv();

  // Resolved before any database work: a missing or ambiguous key should fail
  // in the first second, not after loading the register.
  const provider = resolveProvider(providerFlag(process.argv));
  const model = provider.model;

  const incidents = await loadIncidents();
  if (incidents.length === 0) {
    throw new Error('No incidents in the database. Run `npm run etl` first.');
  }

  const existing = force ? null : readCache();

  // Reusable only if it was produced by this same prompt *and* this same model.
  // Every finding is stamped with the model that produced it, so mixing two
  // vendors' output under one label would make the audit trail a lie, and a
  // finding the other model would not have made is not a finding this run can
  // claim. Switching provider therefore reclassifies from scratch.
  const reusable =
    existing?.promptVersion === PROMPT_VERSION && existing.model === model
      ? existing.findings
      : [];
  const alreadyDone = new Set(reusable.map((f) => f.incident_id));

  const todo = incidents.filter((i) => !alreadyDone.has(i.id));

  console.log(`\n${incidents.length} incidents, ${todo.length} to classify`);
  console.log(
    `provider: ${provider.name}, model: ${model}, prompt: ${PROMPT_VERSION}\n`,
  );

  if (todo.length === 0) {
    console.log('Nothing to do. Use --force to reclassify everything.\n');
    return;
  }

  const byId = new Map<string, SourceIncident>(
    incidents.map((i) => [i.id, i]),
  );

  const accepted: GroundedFinding[] = [];
  const rejected: Rejection[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const [index, batch] of chunk(todo, BATCH_SIZE).entries()) {
    process.stdout.write(
      `  batch ${index + 1} (${batch.length} incidents) ... `,
    );

    const turns: ChatTurn[] = [
      { role: 'user', content: buildUserMessage(batch) },
    ];

    const response = await provider.complete(SYSTEM_PROMPT, turns, OUTPUT);

    inputTokens += response.inputTokens;
    outputTokens += response.outputTokens;

    const parsed = response.parsed;
    if (!parsed) {
      throw new Error(
        `Batch ${index + 1} returned no parseable output (stop reason: ${response.stopReason ?? 'unknown'}).`,
      );
    }

    const result = verifyFindings(parsed.findings, byId);
    accepted.push(...result.accepted);

    // One corrective round. The usual failure is the model tidying punctuation
    // while copying, which it fixes readily once told which records failed.
    const notVerbatim = result.rejected.filter(
      (r) => r.reason === 'quote-not-verbatim',
    );

    if (notVerbatim.length > 0) {
      process.stdout.write(`${notVerbatim.length} ungrounded, retrying ... `);

      turns.push({ role: 'assistant', content: JSON.stringify(parsed) });
      turns.push({
        role: 'user',
        content: buildRegroundingMessage(
          notVerbatim.map((r) => ({ incidentId: r.incidentId, quote: r.quote })),
        ),
      });

      const retry = await provider.complete(SYSTEM_PROMPT, turns, OUTPUT);

      inputTokens += retry.inputTokens;
      outputTokens += retry.outputTokens;

      if (retry.parsed) {
        const retried = verifyFindings(retry.parsed.findings, byId);
        accepted.push(...retried.accepted);
        rejected.push(...retried.rejected);
      }
    }

    rejected.push(
      ...result.rejected.filter((r) => r.reason !== 'quote-not-verbatim'),
    );
    console.log(`${result.accepted.length} accepted`);
  }

  // --- report ---------------------------------------------------------------
  const missing = findMissing(todo, accepted);
  const psychosocial = accepted.filter((f) => f.is_psychosocial);
  const mismatches = accepted.filter((f) => f.severityMismatch);

  const estimatedCostUsd = provider.estimateCostUsd(inputTokens, outputTokens);

  console.log(`\n  accepted:              ${accepted.length}`);
  console.log(`  rejected by the gate:  ${rejected.length}`);
  console.log(`  no finding returned:   ${missing.length}`);
  console.log(`  psychosocial hazards:  ${psychosocial.length}`);
  console.log(`  severity mismatches:   ${mismatches.length}`);
  console.log(
    `  tokens: ${inputTokens} in / ${outputTokens} out  ` +
      (estimatedCostUsd === null
        ? '(no rate on file for this model)'
        : `(~$${estimatedCostUsd.toFixed(3)})`),
  );

  if (rejected.length > 0) {
    console.log('\n  rejected findings:');
    for (const r of rejected) {
      console.log(`    ${r.incidentId}  ${r.reason}: ${r.detail}`);
    }
  }
  if (missing.length > 0) {
    console.log(`\n  no finding for: ${missing.join(', ')}`);
  }

  // Merge with anything already cached under this prompt version and model.
  const merged = [
    ...reusable.filter((p) => !accepted.some((a) => a.incident_id === p.incident_id)),
    ...accepted,
  ];

  const cache: FindingsCache = {
    generatedAt: new Date().toISOString(),
    provider: provider.name,
    model,
    promptVersion: PROMPT_VERSION,
    incidentsClassified: merged.length,
    usage: { inputTokens, outputTokens, estimatedCostUsd },
    rejected,
    findings: merged,
  };

  writeCache(cache);
  console.log('\nWrote data/ai/incident_findings.json');
  console.log('Run `npm run etl` to load the findings into the database.\n');
}

try {
  await main();
} catch (error) {
  console.error(
    `\nClassification failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await closePool();
}
