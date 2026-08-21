import { err, ok, type Result } from './result.js';

/**
 * Currency normalisation. The cost column mixes `"$182,946.64"` with
 * `132182.58`, and the credit note is written `"$-23,375.00"`, with the sign
 * inside the currency symbol.
 */

const CURRENCY_PATTERN = /^-?\$?-?[\d,]+(\.\d+)?$/;

export function parseAudAmount(raw: string): Result<number> {
  const value = raw.trim();
  if (value === '') return err('amount is empty');

  if (!CURRENCY_PATTERN.test(value)) {
    return err(`unrecognised currency format: ${raw}`);
  }

  // Both `-$1.00` and `$-1.00` appear in the wild; treat either as negative.
  const negative = value.includes('-');
  const digits = value.replace(/[$,\-\s]/g, '');

  if (digits === '' || digits === '.') {
    return err(`no numeric content in amount: ${raw}`);
  }

  const amount = Number(digits);
  if (!Number.isFinite(amount)) {
    return err(`amount is not a finite number: ${raw}`);
  }

  return ok(negative ? -amount : amount);
}
