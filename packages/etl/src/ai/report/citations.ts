import { indexFacts, type ReportFact } from './facts.js';
import type { Claim, ReportSection } from './schema.js';

/**
 * The citation gate.
 *
 * Step 7's grounding gate asks one question of a finding: does its quote appear
 * verbatim in the record it cites. A narrative summary has no source text to
 * quote, so this gate asks the equivalent question of a sentence:
 *
 *   1. does it cite anything at all;
 *   2. does every citation name a fact that exists in the pack;
 *   3. does it name a record without citing it;
 *   4. is every number it states present in one of the facts it cites.
 *
 * Rule 4 is the one that earns its keep. A model that cites correctly and then
 * misstates the figure produces the most dangerous output this project can
 * emit — a wrong number wearing a citation, which reads as *more* trustworthy
 * than an uncited one. Checking the arithmetic of the prose against the pack is
 * what stops that, and it is why the fact pack exists as a closed set rather
 * than the model being handed a database connection.
 *
 * What this gate does NOT prove, and the write-up says so plainly: that the
 * claim's *interpretation* is sound. "Scope 1 rose 47.6%" and "Scope 1 rose
 * 47.6%, which is excellent news" both pass. Mechanical traceability is what a
 * machine can certify; judgement stays with the reader, which is why every
 * claim ships with its citations visible rather than footnoted away.
 */

export type RejectionReason =
  | 'no-citations'
  | 'unknown-fact'
  | 'uncited-record'
  | 'unsupported-number';

export type ClaimRejection = {
  section: ReportSection;
  text: string;
  citations: string[];
  reason: RejectionReason;
  detail: string;
};

export type VerifiedClaim = {
  section: ReportSection;
  text: string;
  citations: string[];
};

export type VerificationResult = {
  accepted: VerifiedClaim[];
  rejected: ClaimRejection[];
};

/**
 * Years are exempt from the number check.
 *
 * A bare `2026` in "the March 2026 outage" is a date, not a quantity, and the
 * period bounds are themselves facts — so requiring a citation for the year
 * would reject correct sentences without closing any hole a fabricated *figure*
 * could come through. Nothing outside this window is exempt.
 */
const FIRST_PLAUSIBLE_YEAR = 1900;
const LAST_PLAUSIBLE_YEAR = 2100;

type WrittenNumber = { token: string; value: number };

/**
 * Unicode minus and en dash are normalised to ASCII first: models emit them
 * freely in ranges and negative percentages, and `−65%` failing to parse would
 * make a correct claim look like an unsupported one.
 */
function normalise(text: string): string {
  return text.replace(/[−–]/g, '-');
}

export function extractNumbers(text: string): WrittenNumber[] {
  const matches = normalise(text).match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((token) => ({
    token,
    value: Number(token.replace(/,/g, '')),
  }));
}

/** Digits written after the decimal point — the precision the author claimed. */
function decimalsOf(token: string): number {
  return token.split('.')[1]?.length ?? 0;
}

/**
 * Does a written number state this fact's value?
 *
 * Rounding is allowed, to exactly the precision written and no further: 47 may
 * stand for 47.3, and 1219185 for 1219184.94, because that is a fair rendering
 * of the same figure. 1.2 may not stand for 1234567 — a change of unit or
 * magnitude is a new number, and the pack carries both kg and tonnes so the
 * model never has to convert one into the other.
 */
export function numberMatches(written: WrittenNumber, actual: number): boolean {
  if (written.value === actual) return true;
  const tolerance = 0.5 * 10 ** -decimalsOf(written.token);
  // The epsilon covers binary representation error on values like 0.05, where
  // the difference and the tolerance are equal in decimal but not in floating
  // point.
  return Math.abs(written.value - actual) <= tolerance + 1e-9;
}

/** Every number a fact puts on the table: its value, and any figure in its text. */
function numbersIn(fact: ReportFact): number[] {
  const values: number[] = [];
  if (typeof fact.value === 'number') values.push(fact.value);

  // Label and detail included on purpose. A claim that quotes an incident
  // description back ("a 12500 L credit note") is drawing on the record it
  // cited, and that is exactly the traceability this gate is trying to reward.
  for (const text of [String(fact.value), fact.label, fact.detail ?? '']) {
    for (const number of extractNumbers(text)) values.push(number.value);
  }
  return values;
}

function isYear(written: WrittenNumber): boolean {
  return (
    decimalsOf(written.token) === 0 &&
    Number.isInteger(written.value) &&
    written.value >= FIRST_PLAUSIBLE_YEAR &&
    written.value <= LAST_PLAUSIBLE_YEAR
  );
}

/** Matches an id only as a whole token, so `INC-2025-11` never matches `INC-2025-118`. */
function mentions(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`).test(text);
}

function stripIds(text: string, ids: string[]): string {
  return ids.reduce((stripped, id) => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return stripped.replace(
      new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, 'g'),
      ' ',
    );
  }, text);
}

export function verifyClaims(
  claims: Claim[],
  facts: ReportFact[],
): VerificationResult {
  const byId = indexFacts(facts);
  const accepted: VerifiedClaim[] = [];
  const rejected: ClaimRejection[] = [];

  for (const claim of claims) {
    const base = {
      section: claim.section,
      text: claim.text,
      citations: claim.citations,
    };

    if (claim.citations.length === 0) {
      rejected.push({
        ...base,
        reason: 'no-citations',
        detail: 'The claim cites no facts, so nothing about it can be checked.',
      });
      continue;
    }

    const unknown = claim.citations.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      rejected.push({
        ...base,
        reason: 'unknown-fact',
        detail: `Cites ${unknown.join(', ')}, which ${
          unknown.length === 1 ? 'is not a fact' : 'are not facts'
        } in the pack.`,
      });
      continue;
    }

    // A record named in the prose but left out of the citations. The numbers in
    // its id would sail through the check below as year-like or incidental, so
    // this is caught by name rather than by arithmetic.
    const uncited = facts
      .filter((fact) => !claim.citations.includes(fact.id))
      .filter((fact) => mentions(claim.text, fact.id))
      .map((fact) => fact.id);

    if (uncited.length > 0) {
      rejected.push({
        ...base,
        reason: 'uncited-record',
        detail: `Names ${uncited.join(', ')} without citing ${
          uncited.length === 1 ? 'it' : 'them'
        }.`,
      });
      continue;
    }

    const cited = claim.citations.map((id) => byId.get(id) as ReportFact);
    const allowed = cited.flatMap(numbersIn);

    const unsupported = extractNumbers(
      stripIds(claim.text, claim.citations),
    ).filter(
      (written) =>
        !isYear(written) &&
        !allowed.some((value) => numberMatches(written, value)),
    );

    if (unsupported.length > 0) {
      rejected.push({
        ...base,
        reason: 'unsupported-number',
        detail: `States ${unsupported
          .map((n) => n.token)
          .join(', ')}, which ${
          unsupported.length === 1 ? 'does' : 'do'
        } not appear in the cited facts.`,
      });
      continue;
    }

    accepted.push(base);
  }

  return { accepted, rejected };
}
