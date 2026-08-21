/**
 * Supplier name canonicalisation and duplicate detection.
 *
 * Two entities appear twice, each hidden a different way: a legal-suffix variant
 * (Pty Ltd against P/L), which suffix stripping catches, and a typo sharing an
 * ABN (Maintenance against Maintanence), which needs edit distance. Unmerged
 * duplicates understate a supplier's spend (Ironline is $8.94M in the file and
 * $10.15M in reality); over-eager merging combines two real businesses.
 */

/** Trailing legal-form tokens that carry no identity. */
const LEGAL_SUFFIXES = new Set([
  'pty',
  'ptyltd',
  'ltd',
  'limited',
  'pl',
  'inc',
  'incorporated',
  'co',
  'company',
  'corp',
  'corporation',
  'group',
  'holdings',
]);

/**
 * Reduce a trading name to its identifying core.
 *
 *   'Ironline Fuel Distributors Pty Ltd' -> 'ironline fuel distributors'
 *   'Ironline Fuel Distributors P/L'     -> 'ironline fuel distributors'
 */
export function canonicaliseEntityName(name: string): string {
  let value = name.toLowerCase();

  // '&' and 'and' are the same word to a human reader.
  value = value.replace(/&/g, ' and ');

  // Punctuation carries no identity: 'P/L' and 'P.L.' are both 'pl'.
  value = value.replace(/[^a-z0-9\s]/g, '');
  value = value.replace(/\s+/g, ' ').trim();

  // Strip legal suffixes from the end only. Removing them anywhere would
  // mangle 'Coral Coast Camp Catering' -> the 'co' in 'Coast' is not a suffix,
  // and token-wise removal from the tail avoids that whole class of bug.
  let tokens = value.split(' ');
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens = tokens.slice(0, -1);
  }

  return tokens.join(' ');
}

/** Standard Levenshtein distance, iterative with a single row buffer. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = current[j - 1]! + 1;
      const deletion = previous[j]! + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }

  return previous[b.length]!;
}

export type DuplicateMatch = {
  isDuplicate: boolean;
  /** Why we think so, shown to the user rather than asserted silently. */
  reason:
    | 'identical-abn'
    | 'identical-canonical-name'
    | 'near-identical-name'
    | 'no-match';
  editDistance: number;
};

/**
 * Two covers the observed defect ('maintenance' against 'maintanence') without
 * reaching far enough to merge distinct suppliers. Across all 105 pairs in this
 * file the closest genuinely different pair is 17 edits apart, so the threshold
 * sits in a wide empty gap rather than next to a near-miss.
 */
const MAX_EDIT_DISTANCE = 2;

/** Below this length, a distance of 2 is a large proportion of the name. */
const MIN_LENGTH_FOR_FUZZY_MATCH = 10;

export function compareEntities(
  a: { name: string; abn: string | null },
  b: { name: string; abn: string | null },
): DuplicateMatch {
  const canonicalA = canonicaliseEntityName(a.name);
  const canonicalB = canonicaliseEntityName(b.name);
  const distance = levenshtein(canonicalA, canonicalB);

  // A shared ABN is the strongest signal available: it is the client's own
  // assertion that these are one legal entity, and it does not depend on our
  // string handling at all.
  if (a.abn && b.abn && a.abn === b.abn) {
    return { isDuplicate: true, reason: 'identical-abn', editDistance: distance };
  }

  if (canonicalA === canonicalB) {
    return {
      isDuplicate: true,
      reason: 'identical-canonical-name',
      editDistance: 0,
    };
  }

  const longEnough =
    Math.min(canonicalA.length, canonicalB.length) >= MIN_LENGTH_FOR_FUZZY_MATCH;

  if (longEnough && distance <= MAX_EDIT_DISTANCE) {
    return {
      isDuplicate: true,
      reason: 'near-identical-name',
      editDistance: distance,
    };
  }

  return { isDuplicate: false, reason: 'no-match', editDistance: distance };
}
