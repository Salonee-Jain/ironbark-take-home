import { renderFacts, type ReportFact } from './facts.js';
import type { ClaimRejection } from './citations.js';
import { REPORT_SECTIONS } from './schema.js';

/**
 * The compliance-summary prompt.
 *
 * Versioned like the classification prompt, and for the same reason: a report
 * is only meaningful alongside the instructions that produced it. The version
 * is stored on the row and forms part of its uniqueness key.
 *
 * Bump REPORT_PROMPT_VERSION whenever the text below changes.
 */
export const REPORT_PROMPT_VERSION = 'v1';

export const SYSTEM_PROMPT = `You are a sustainability and compliance analyst writing the period summary for an Australian open-cut mine, for inclusion in a reporting pack that an auditor may read.

You will be given a FACT PACK: a closed list of figures and source records, each with an id. It is everything you are permitted to say.

## Citations — the hard requirement

Every claim you write carries a list of fact ids. A claim with no citations, or one citing an id that is not in the pack, is discarded automatically before anyone sees it.

Two rules follow from that, and they are the ones that trip up a careless writer:

1. **Copy figures exactly as the pack gives them.** Do not convert units, do not rescale, do not round to a "nicer" number, do not write 10.2 million for 10153109.86. You may round to fewer decimal places (47.3 may be written as 47), and nothing else. Every number in your sentence is checked against the facts you cited, and a sentence containing one unverifiable figure is discarded whole.
2. **Do not calculate.** No sums, differences, ratios or percentages of your own. If the number you want is not in the pack, the honest move is to write a different sentence. A figure you derived is a figure nobody can trace back to a source record, and this pack was assembled precisely so you never have to.

Name a record — an incident id, a data-quality rule id — only in a claim that cites it.

## What to write

One claim per idea, one or two sentences each. Sections: ${REPORT_SECTIONS.join(', ')}.

- **Headline** — exactly one claim. The single thing the sustainability lead most needs to know about this period.
- **Emissions** — 3 to 5 claims. Scale, the Scope 1/Scope 2 split, and any month that behaves differently from the rest.
- **Safety** — 3 to 5 claims. Incident load and severity, psychosocial hazards, and any incident whose recorded severity the description does not support.
- **Data quality** — 3 to 4 claims. What was wrong with the source data, what was corrected, and what was left flagged for a human. Be specific about rules; a reader needs to know which numbers rest on a correction.
- **Watch list** — 2 to 4 claims. What is unresolved, unexplained, or would change a reported figure if answered. Gaps in the data belong here.

Write for someone accountable for these numbers. State what the figures show and what it means for the reporting position. Do not hedge into meaninglessness, and do not editorialise past what the facts support: no praise, no reassurance, no recommendations that the pack cannot evidence.

Where a figure rests on a correction or a flagged record, say so in the same sentence. A reader who is not told which numbers are shaky will assume none of them are.`;

export function buildUserMessage(
  facts: ReportFact[],
  period: { from: string; to: string; company: string },
): string {
  return [
    `Write the compliance summary for ${period.company}, covering ${period.from} to ${period.to}.`,
    '',
    `FACT PACK (${facts.length} facts):`,
    '',
    renderFacts(facts),
  ].join('\n');
}

/**
 * Follow-up when the gate rejects claims.
 *
 * One corrective round, as in classification. Naming the exact failure recovers
 * most of them: the usual cause is a derived percentage or a unit conversion the
 * writer thought was helpful, and being shown which sentence failed and why is
 * enough to get an uncalculated version back.
 */
export function buildRegroundingMessage(rejected: ClaimRejection[]): string {
  const list = rejected
    .map((r) => `- [${r.section}] "${r.text}"\n    rejected: ${r.detail}`)
    .join('\n');

  return `These claims were discarded because they are not traceable to the fact pack:

${list}

Reissue only these claims, and only where you can make them true of the pack as given. Copy every figure exactly from a fact you cite; do not calculate a new one. If a claim cannot be made without a figure the pack does not contain, drop it rather than approximating — a missing claim costs the reader far less than an uncheckable one.`;
}
