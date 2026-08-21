import type { AiProvider, ChatTurn } from '../providers/index.js';
import {
  verifyClaims,
  type ClaimRejection,
  type VerifiedClaim,
} from './citations.js';
import { factDigest, type ReportFact } from './facts.js';
import {
  buildRegroundingMessage,
  buildUserMessage,
  REPORT_PROMPT_VERSION,
  SYSTEM_PROMPT,
} from './prompt.js';
import {
  REPORT_SECTIONS,
  ReportResponseSchema,
  type ReportSection,
} from './schema.js';

/**
 * One compliance summary, generated and verified.
 *
 * Everything here is vendor-agnostic and database-agnostic: it takes a provider
 * and a fact pack, and returns a report plus an account of what the gate threw
 * away. The caller decides where the facts came from and where the result goes,
 * which is what lets the same code path serve the API endpoint and the CLI that
 * refreshes the committed artefact.
 */

const OUTPUT = { name: 'compliance_summary', schema: ReportResponseSchema };

export type ReportPeriod = { from: string; to: string; company: string };

/**
 * A rejection, with the round it happened in.
 *
 * Both rounds are reported, including a claim that was rejected first time and
 * successfully reissued second time. That inflates nothing: the sentence really
 * was discarded, and a run that hid its first-round failures would present a
 * clean record of a process that needed correcting. The rejections are the
 * evidence the gate is doing something.
 */
export type ReportRejection = ClaimRejection & { round: 1 | 2 };

export type ReportSectionOutput = {
  section: ReportSection;
  claims: { text: string; citations: string[] }[];
};

export type GeneratedReport = {
  promptVersion: string;
  provider: string;
  model: string;
  period: ReportPeriod;
  factDigest: string;
  facts: ReportFact[];
  sections: ReportSectionOutput[];
  /** What the gate refused. Kept, not swallowed: it is part of the record. */
  rejected: ReportRejection[];
  claimsAccepted: number;
  claimsRejected: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
  };
};

/** Claims in a stable order, grouped, with empty sections dropped. */
export function groupBySection(claims: VerifiedClaim[]): ReportSectionOutput[] {
  return REPORT_SECTIONS.map((section) => ({
    section,
    claims: claims
      .filter((claim) => claim.section === section)
      .map(({ text, citations }) => ({ text, citations })),
  })).filter((group) => group.claims.length > 0);
}

/** Same sentence twice — possible once a corrective round reissues a claim. */
function dedupe(claims: VerifiedClaim[]): VerifiedClaim[] {
  const seen = new Set<string>();
  return claims.filter((claim) => {
    const key = claim.text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateReport(
  provider: AiProvider,
  facts: ReportFact[],
  period: ReportPeriod,
): Promise<GeneratedReport> {
  if (facts.length === 0) {
    throw new Error(
      'The fact pack is empty. Load a dataset before generating a summary.',
    );
  }

  const turns: ChatTurn[] = [
    { role: 'user', content: buildUserMessage(facts, period) },
  ];

  const response = await provider.complete(SYSTEM_PROMPT, turns, OUTPUT);
  let inputTokens = response.inputTokens;
  let outputTokens = response.outputTokens;

  if (!response.parsed) {
    throw new Error(
      `The model returned no parseable summary (stop reason: ${
        response.stopReason ?? 'unknown'
      }).`,
    );
  }

  const first = verifyClaims(response.parsed.claims, facts);
  const accepted = [...first.accepted];
  const rejected: ReportRejection[] = first.rejected.map((r) => ({
    ...r,
    round: 1 as const,
  }));

  // One corrective round, as in classification. The usual failure is a derived
  // figure — a percentage the model worked out rather than read — and naming the
  // offending sentence recovers most of them. Claims that fail twice are gone:
  // a second retry would be the model arguing with the gate, and the gate wins.
  if (first.rejected.length > 0) {
    turns.push({ role: 'assistant', content: JSON.stringify(response.parsed) });
    turns.push({ role: 'user', content: buildRegroundingMessage(first.rejected) });

    const retry = await provider.complete(SYSTEM_PROMPT, turns, OUTPUT);
    inputTokens += retry.inputTokens;
    outputTokens += retry.outputTokens;

    if (retry.parsed) {
      const second = verifyClaims(retry.parsed.claims, facts);
      accepted.push(...second.accepted);
      rejected.push(...second.rejected.map((r) => ({ ...r, round: 2 as const })));
    }
  }

  const claims = dedupe(accepted);

  return {
    promptVersion: REPORT_PROMPT_VERSION,
    provider: provider.name,
    model: provider.model,
    period,
    factDigest: factDigest(facts),
    facts,
    sections: groupBySection(claims),
    rejected,
    claimsAccepted: claims.length,
    claimsRejected: rejected.length,
    usage: {
      inputTokens,
      outputTokens,
      estimatedCostUsd: provider.estimateCostUsd(inputTokens, outputTokens),
    },
  };
}
