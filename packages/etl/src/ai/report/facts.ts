import { createHash } from 'node:crypto';

/**
 * The fact pack: everything the model is allowed to say.
 *
 * The compliance summary is not generated from the database. It is generated
 * from *this* — a fixed list of pre-computed figures and source records, each
 * with an id — and the gate in `citations.ts` refuses any claim that reaches
 * outside it. The model's job is to select, order and explain; it is never the
 * thing that computes a number, because a number a model computed is a number
 * nobody can trace.
 *
 * That inversion is the whole design. Classification (step 7) had a natural
 * anchor: the source description, which a quote must appear in verbatim. A
 * narrative summary has no such text to quote, so the anchor has to be
 * manufactured — hence a closed set of facts with stable ids, assembled in SQL
 * before the model is called.
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
  /** Free text a claim may also draw numbers from — a description, a rationale. */
  detail: string | null;
};

/**
 * A stable fingerprint of the pack.
 *
 * Two uses, both about not showing a reader a report that no longer describes
 * their data. A stored report records the digest it was generated against, so
 * the API can tell whether the underlying figures have moved since; and the
 * committed cache file is only served to a dataset whose facts reproduce
 * exactly — which is how a reviewer with no API key gets the demo narrative
 * while a company that uploaded its own export correctly gets none.
 *
 * Order-sensitive on purpose: the builders emit facts in a fixed order, and a
 * pack that reordered would be a different prompt.
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
 * Grouping separators are deliberately absent.
 *
 * The model is told to copy figures exactly as given, and the gate parses what
 * it wrote back into a number. Commas survive that round trip fine, but they
 * also invite the model to "tidy" 10153109.86 into 10.15 million, which the
 * gate then strips as unsupported. Plain digits make the instruction easy to
 * obey, and the frontend does its own formatting anyway.
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
