import { describe, expect, it } from 'vitest';
import {
  canonicaliseEntityName,
  compareEntities,
  levenshtein,
} from './entityName.js';

/**
 * Supplier dedup is wrong in both directions at once: an unmerged duplicate
 * understates a supplier's spend by millions, and an over-eager merge combines
 * two real businesses. Both tested here, the second more heavily.
 */

describe('canonicaliseEntityName', () => {
  it('collapses the two spellings of the same legal form', () => {
    expect(canonicaliseEntityName('Ironline Fuel Distributors Pty Ltd')).toBe(
      canonicaliseEntityName('Ironline Fuel Distributors P/L'),
    );
  });

  it.each([
    'Acme Pty Ltd',
    'Acme Ltd',
    'Acme Limited',
    'Acme P/L',
    'Acme Pty. Ltd.',
    'ACME PTY LTD',
  ])('reduces %s to its identifying core', (name) => {
    expect(canonicaliseEntityName(name)).toBe('acme');
  });

  it('only strips suffix words from the end', () => {
    // 'Coast' contains 'co'. Removing suffix tokens anywhere would mangle this.
    expect(canonicaliseEntityName('Coral Coast Camp Catering')).toBe(
      'coral coast camp catering',
    );
  });

  it('never strips a name down to nothing', () => {
    expect(canonicaliseEntityName('Holdings')).toBe('holdings');
  });

  it('treats & and "and" as the same word', () => {
    expect(canonicaliseEntityName('Smith & Sons')).toBe(
      canonicaliseEntityName('Smith and Sons'),
    );
  });
});

describe('levenshtein', () => {
  it('measures the observed typo at distance 2', () => {
    expect(levenshtein('maintenance', 'maintanence')).toBe(2);
  });

  it.each([
    ['', '', 0],
    ['a', '', 1],
    ['', 'abc', 3],
    ['abc', 'abc', 0],
    ['kitten', 'sitting', 3],
  ])('levenshtein(%s, %s) = %i', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });

  it('is symmetric', () => {
    expect(levenshtein('blackwood heavy maintenance', 'blackwood heavy maintanence')).toBe(
      levenshtein('blackwood heavy maintanence', 'blackwood heavy maintenance'),
    );
  });
});

describe('compareEntities', () => {
  it('merges on a shared ABN, whatever the names look like', () => {
    // The client's own assertion that these are one entity — stronger than any
    // string handling of ours, and independent of it.
    const match = compareEntities(
      { name: 'Blackwood Heavy Maintenance', abn: '11222333444' },
      { name: 'Blackwood Heavy Maintanence', abn: '11222333444' },
    );
    expect(match.isDuplicate).toBe(true);
    expect(match.reason).toBe('identical-abn');
  });

  it('merges on canonical name when one duplicate has no ABN', () => {
    // The Ironline case: the duplicate row carries no ABN at all, so the shared
    // -ABN path cannot fire and the suffix stripping has to carry it.
    const match = compareEntities(
      { name: 'Ironline Fuel Distributors Pty Ltd', abn: '11222333444' },
      { name: 'Ironline Fuel Distributors P/L', abn: null },
    );
    expect(match.isDuplicate).toBe(true);
    expect(match.reason).toBe('identical-canonical-name');
  });

  it('merges a typo within the edit threshold', () => {
    const match = compareEntities(
      { name: 'Blackwood Heavy Maintenance', abn: null },
      { name: 'Blackwood Heavy Maintanence', abn: null },
    );
    expect(match.isDuplicate).toBe(true);
    expect(match.reason).toBe('near-identical-name');
    expect(match.editDistance).toBe(2);
  });

  it('keeps genuinely different suppliers apart', () => {
    const match = compareEntities(
      { name: 'Ironline Fuel Distributors Pty Ltd', abn: '11111111111' },
      { name: 'Coral Coast Camp Catering', abn: '22222222222' },
    );
    expect(match.isDuplicate).toBe(false);
    expect(match.reason).toBe('no-match');
  });

  it('does not fuzzy-match short names, where 2 edits is most of the name', () => {
    // 'BHP' and 'BHD' are two edits apart in a three-letter name. Merging those
    // would be the expensive kind of wrong.
    const match = compareEntities(
      { name: 'ACME', abn: null },
      { name: 'ACNE', abn: null },
    );
    expect(match.isDuplicate).toBe(false);
  });

  it('does not merge two suppliers that merely share a word', () => {
    const match = compareEntities(
      { name: 'Blackwood Heavy Maintenance', abn: null },
      { name: 'Blackwood Drilling Services', abn: null },
    );
    expect(match.isDuplicate).toBe(false);
  });

  it('treats a missing ABN on both sides as no evidence, not as agreement', () => {
    // Two nulls must never read as "same ABN".
    const match = compareEntities(
      { name: 'Alpha Mining Services', abn: null },
      { name: 'Omega Logistics Group', abn: null },
    );
    expect(match.isDuplicate).toBe(false);
    expect(match.reason).toBe('no-match');
  });
});
