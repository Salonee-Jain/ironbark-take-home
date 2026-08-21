/**
 * Australian Business Number validation: 11 digits with a weighted modulus-89
 * checksum.
 *
 * `wellFormed` and `checksumValid` are deliberately separate, because every ABN
 * in suppliers.csv is well formed and every one fails the checksum. A rule that
 * fails for 100% of its rows means the source is systematically different from
 * what the rule assumes, so the checksum is reported once at file level while
 * the structural defect (a 7-digit value, two blanks) is reported per row.
 */

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

export type NormalisedAbn = {
  /** Digits only, or null when absent. */
  digits: string | null;
  present: boolean;
  /** Exactly 11 digits. */
  wellFormed: boolean;
  /** Passes the ATO modulus-89 checksum. Only meaningful when well-formed. */
  checksumValid: boolean;
};

export function isAbnChecksumValid(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;

  const values = [...digits].map(Number);
  values[0] = values[0]! - 1;

  const sum = values.reduce(
    (total, digit, index) => total + digit * ABN_WEIGHTS[index]!,
    0,
  );
  return sum % 89 === 0;
}

export function normaliseAbn(raw: string | null | undefined): NormalisedAbn {
  const digits = (raw ?? '').replace(/\D/g, '');

  if (digits === '') {
    return {
      digits: null,
      present: false,
      wellFormed: false,
      checksumValid: false,
    };
  }

  const wellFormed = digits.length === 11;
  return {
    digits,
    present: true,
    wellFormed,
    checksumValid: wellFormed && isAbnChecksumValid(digits),
  };
}
