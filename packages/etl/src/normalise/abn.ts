/**
 * Australian Business Number validation.
 *
 * An ABN is 11 digits with a weighted modulus-89 checksum: subtract 1 from the
 * first digit, multiply each digit by its weight, and the sum must divide by 89.
 *
 * **Finding that shapes how this gets reported:** every one of the 13 ABNs in
 * `suppliers.csv` is 11 digits and correctly spaced, and every one of them fails
 * the checksum. They are plausible-looking invented numbers, which is what a
 * synthetic dataset should contain.
 *
 * So the two checks are kept deliberately separate:
 *
 *   `wellFormed`     — 11 digits present. Fails for TerraForm's 7-digit value
 *                      and the two blanks. This is a real, row-level defect
 *                      worth flagging in the client's own register.
 *
 *   `checksumValid`  — the arithmetic. Fails for all 13.
 *
 * When a rule fails for 100% of the rows it applies to, the honest conclusion is
 * that the source is systematically different from what the rule assumes — not
 * that the client has thirteen separate problems. Step 4 therefore reports the
 * checksum result once, as a single file-level observation, instead of emitting
 * thirteen row-level issues that would bury the one genuine ABN defect.
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
