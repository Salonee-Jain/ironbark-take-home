import { createHash } from 'node:crypto';

/**
 * The fact pack: everything the model is allowed to say.
 *
 * The summary is generated from this fixed list of pre-computed figures and
 * source records, not from the database, and the gate in citations.ts refuses
 * any claim that reaches outside it. The model selects, orders and explains. It
 * never computes a number, because a number a model computed is a number nobody
 * can trace.
 */

export type ReportFact = {
  /**
   * Cited verbatim by the model, and rendered as a chip in the UI.
   *
   * Record facts use the record's own business key (`INC-2025-118`,
   * `FUEL-DUP-01`) rather than a synthetic id, so a citation reads as something
   * a compliance user can look up in the source file rather than a token that
   * means nothing outside this payload.
   */
  id: string;
  /** `metric` is a computed figure; `record` is one row of source data. */
  kind: 'metric' | 'record';
  label: string;
  value: number | string;
  unit: string | null;
  /** Which view, table or file the value came from. Shown next to the chip. */
  source: string;
  /** Free text a claim may also draw numbers from, a description, a rationale. */
  detail: string | null;
};

/**
 * A stable fingerprint of the pack, used to tell whether a stored report still
 * describes the data, and to decide whether the committed cache file may be
 * served to this dataset at all.
 *
 * Order-sensitive on purpose: the pack is part of a prompt, and a reordered pack
 * is a different prompt.
 */
export function factDigest(facts: ReportFact[]): string {
  const canonical = facts.map((fact) => [
    fact.id,
    fact.kind,
    fact.label,
    fact.value,
    fact.unit,
    fact.source,
    fact.detail,
  ]);
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 16);
}

export function indexFacts(facts: ReportFact[]): Map<string, ReportFact> {
  return new Map(facts.map((fact) => [fact.id, fact]));
}

/** How a fact's value reads in prose, and the string the model should copy. */
export function renderValue(fact: ReportFact): string {
  const value =
    typeof fact.value === 'number' ? formatNumber(fact.value) : fact.value;
  return fact.unit ? `${value} ${fact.unit}` : value;
}

/**
 * Grouping separators are deliberately absent. Commas survive the round trip,
 * but they invite the model to "tidy" 10153109.86 into 10.15 million, which the
 * gate then strips. The frontend does its own formatting anyway.
 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round2(value));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The fact pack as the model sees it. */
export function renderFacts(facts: ReportFact[]): string {
  return facts
    .map((fact) =>
      [
        `<fact id="${fact.id}" kind="${fact.kind}">`,
        `label: ${fact.label}`,
        `value: ${renderValue(fact)}`,
        `source: ${fact.source}`,
        ...(fact.detail ? [`detail: ${fact.detail}`] : []),
        `</fact>`,
      ].join('\n'),
    )
    .join('\n\n');
}
