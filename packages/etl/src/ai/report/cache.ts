import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { artefactWritePath, readArtefact } from '../artefacts.js';
import type { GeneratedReport } from './generate.js';

/**
 * The committed compliance summary, for the same reason as the findings cache: a
 * reviewer should not have to buy inference to see the feature work.
 *
 * What makes it safe to ship is that the file carries the facts it was written
 * from. The API re-verifies every claim against the dataset asking for it, so a
 * company that uploaded its own export is shown nothing rather than someone
 * else's narrative over its numbers.
 */

export const REPORT_CACHE_PATH = artefactWritePath('summary');

export type ReportCache = GeneratedReport & { generatedAt: string };

export function readReportCache(): ReportCache | null {
  const contents = readArtefact('summary');
  if (contents === null) return null;
  try {
    return JSON.parse(contents) as ReportCache;
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
