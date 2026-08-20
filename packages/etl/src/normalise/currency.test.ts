import { describe, expect, it } from 'vitest';
import { parseAudAmount } from './currency.js';

describe('parseAudAmount', () => {
  it('parses a formatted amount', () => {
    expect(parseAudAmount('$182,946.64')).toEqual({ ok: true, value: 182946.64 });
  });

  it('parses a bare number', () => {
    expect(parseAudAmount('132182.58')).toEqual({ ok: true, value: 132182.58 });
  });

  it('handles the sign inside the currency symbol', () => {
    // The credit note is written "$-23,375.00". A parser that strips $ and then
    // demands a leading sign rejects it; one that is too loose reads it as
    // positive and the credit silently stops netting off Scope 1.
    expect(parseAudAmount('$-23,375.00')).toEqual({ ok: true, value: -23375 });
  });

  it('handles the sign outside the currency symbol', () => {
    expect(parseAudAmount('-$23,375.00')).toEqual({ ok: true, value: -23375 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseAudAmount('  $1,000.00  ')).toEqual({ ok: true, value: 1000 });
  });

  it('parses zero', () => {
    expect(parseAudAmount('$0.00')).toEqual({ ok: true, value: 0 });
  });

  it.each(['', '   ', 'N/A', '$', 'twelve dollars', '1.2.3', '$1,000.00AUD'])(
    'rejects %s rather than guessing',
    (input) => {
      expect(parseAudAmount(input).ok).toBe(false);
    },
  );
});
