import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the committed AI output lives, and how to find it wherever the code is
 * running.
 *
 * Locally this file sits in the repository and the artefacts are four
 * directories up. In a deployed bundle it does not: the code is compiled into a
 * single file somewhere else, and the artefacts are copied in relative to the
 * working directory. Both are checked, because the alternative is an
 * application that quietly has no AI layer in production and no clue why.
 */

const FILE_NAMES = {
  findings: 'incident_findings.json',
  summary: 'compliance_summary.json',
} as const;

/**
 * The repository path, which is where the generators write.
 *
 * Null once bundled: `import.meta.url` does not survive compilation into a
 * single file, and reading it unguarded would throw at import time. The
 * generators only ever run from the repository, so a null here costs nothing.
 */
const repoArtefactDir = (() => {
  try {
    const url = import.meta.url;
    if (!url) return null;
    return resolve(dirname(fileURLToPath(url)), '../../../..', 'data', 'ai');
  } catch {
    return null;
  }
})();

export function artefactWritePath(name: keyof typeof FILE_NAMES): string {
  return join(repoArtefactDir ?? join(process.cwd(), 'data', 'ai'), FILE_NAMES[name]);
}

function candidateDirs(): string[] {
  const configured = process.env['AI_ARTEFACT_DIR']?.trim();
  return [
    ...(configured ? [configured] : []),
    ...(repoArtefactDir ? [repoArtefactDir] : []),
    join(process.cwd(), 'data', 'ai'),
  ];
}

/** The artefact's contents, or null when it is not deployed alongside the code. */
export function readArtefact(name: keyof typeof FILE_NAMES): string | null {
  for (const dir of candidateDirs()) {
    const path = join(dir, FILE_NAMES[name]);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  return null;
}
