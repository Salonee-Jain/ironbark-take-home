/**
 * Incident classification.
 *
 *   npm run ai:classify              classify anything not already cached
 *   npm run ai:classify -- --force   reclassify everything
 *
 * Reads incidents from the database, sends them to Claude in batches, verifies
 * every finding against its source record, and writes the survivors to a cache
 * committed to the repo. Requires ANTHROPIC_API_KEY; nothing else in the
 * project does.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { closePool, getPool } from '@ironbark/db';
import { writeCache, readCache, type FindingsCache } from './cache.js';
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
import { BatchResponseSchema } from './schema.js';

/**
 * Incidents per request.
 *
 * Small enough that one bad response costs little and the model keeps every
 * description in close view; large enough that the system prompt is amortised
 * rather than re-sent 42 times.
 */
const BATCH_SIZE = 8;

/** Per-million-token rates for the default model, for the cost report. */
const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

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
  const model = process.env['ANTHROPIC_MODEL'] ?? 'claude-opus-5';

  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set.\n' +
        '  Add it to .env, then re-run. The committed cache at data/ai/incident_findings.json\n' +
        '  means the rest of the application runs without one.',
    );
  }

  const incidents = await loadIncidents();
  if (incidents.length === 0) {
    throw new Error('No incidents in the database. Run `npm run etl` first.');
  }

  const existing = force ? null : readCache();
  const alreadyDone = new Set(
    existing?.promptVersion === PROMPT_VERSION
      ? existing.findings.map((f) => f.incident_id)
      : [],
  );

  const todo = incidents.filter((i) => !alreadyDone.has(i.id));

  console.log(`\n${incidents.length} incidents, ${todo.length} to classify`);
  console.log(`model: ${model}, prompt: ${PROMPT_VERSION}\n`);

  if (todo.length === 0) {
    console.log('Nothing to do. Use --force to reclassify everything.\n');
    return;
  }

  const client = new Anthropic();
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

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildUserMessage(batch) },
    ];

    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
      output_config: { format: zodOutputFormat(BatchResponseSchema) },
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new Error(
        `Batch ${index + 1} returned no parseable output (stop_reason: ${response.stop_reason}).`,
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

      messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
      messages.push({
        role: 'user',
        content: buildRegroundingMessage(
          notVerbatim.map((r) => ({ incidentId: r.incidentId, quote: r.quote })),
        ),
      });

      const retry = await client.messages.parse({
        model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages,
        output_config: { format: zodOutputFormat(BatchResponseSchema) },
      });

      inputTokens += retry.usage.input_tokens;
      outputTokens += retry.usage.output_tokens;

      if (retry.parsed_output) {
        const retried = verifyFindings(retry.parsed_output.findings, byId);
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

  const rates = PRICING_USD_PER_MTOK[model] ?? { input: 5, output: 25 };
  const estimatedCostUsd =
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output;

  console.log(`\n  accepted:              ${accepted.length}`);
  console.log(`  rejected by the gate:  ${rejected.length}`);
  console.log(`  no finding returned:   ${missing.length}`);
  console.log(`  psychosocial hazards:  ${psychosocial.length}`);
  console.log(`  severity mismatches:   ${mismatches.length}`);
  console.log(
    `  tokens: ${inputTokens} in / ${outputTokens} out  (~$${estimatedCostUsd.toFixed(3)})`,
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

  // Merge with anything already cached under this prompt version.
  const previous =
    existing?.promptVersion === PROMPT_VERSION ? existing.findings : [];
  const merged = [
    ...previous.filter((p) => !accepted.some((a) => a.incident_id === p.incident_id)),
    ...accepted,
  ];

  const cache: FindingsCache = {
    generatedAt: new Date().toISOString(),
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
