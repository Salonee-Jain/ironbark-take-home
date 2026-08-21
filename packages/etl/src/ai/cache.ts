import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GroundedFinding, Rejection } from './grounding.js';

/**
 * The findings cache, committed on purpose: `npm run etl` produces a complete
 * database with no API key, and re-running classification shows exactly what
 * changed as a diff.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const CACHE_PATH = join(repoRoot, 'data', 'ai', 'incident_findings.json');

export type FindingsCache = {
  generatedAt: string;
  /** Which vendor produced these findings. Recorded alongside the model so the
   *  artefact says who was asked, not just what was answered. */
  provider: string;
  model: string;
  promptVersion: string;
  incidentsClassified: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    /** null when no published rate is on file for the model. */
    estimatedCostUsd: number | null;
  };
  /** Kept in the artefact: what the gate threw away is part of the record. */
  rejected: Rejection[];
  findings: GroundedFinding[];
};

export function readCache(): FindingsCache | null {
  if (!existsSync(CACHE_PATH)) return null;
  return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as FindingsCache;
}

export function writeCache(cache: FindingsCache): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  // Pretty-printed and stably ordered so the file diffs cleanly between runs.
  const sorted = {
    ...cache,
    findings: [...cache.findings].sort((a, b) =>
      a.incident_id.localeCompare(b.incident_id),
    ),
  };
  writeFileSync(CACHE_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}
