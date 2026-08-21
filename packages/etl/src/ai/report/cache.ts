import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeneratedReport } from './generate.js';

/**
 * The committed compliance summary, for the same reason as the findings cache: a
 * reviewer should not have to buy inference to see the feature work.
 *
 * What makes it safe to ship is the `factDigest` recorded in the file. The API
 * serves it only to a dataset whose facts reproduce that digest, so a company
 * that uploads its own export gets no report rather than someone else's
 * narrative over its numbers.
 */

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);

export const REPORT_CACHE_PATH = join(
  repoRoot,
  'data',
  'ai',
  'compliance_summary.json',
);

export type ReportCache = GeneratedReport & { generatedAt: string };

export function readReportCache(): ReportCache | null {
  if (!existsSync(REPORT_CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REPORT_CACHE_PATH, 'utf8')) as ReportCache;
  } catch {
    // A malformed artefact is a broken file, not a broken application: the
    // endpoint that reads it should fall back to "no report available" rather
    // than 500 on a bad byte in a committed JSON file.
    return null;
  }
}

export function writeReportCache(cache: ReportCache): void {
  mkdirSync(dirname(REPORT_CACHE_PATH), { recursive: true });
  writeFileSync(
    REPORT_CACHE_PATH,
    `${JSON.stringify(cache, null, 2)}\n`,
    'utf8',
  );
}
