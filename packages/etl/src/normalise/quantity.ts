import { err, ok, type Result } from './result.js';

/**
 * Fuel quantity normalisation.
 *
 * The unit column uses four spellings for two units: `L`, `litres`, `Litres`
 * (106 + 19 + 14 rows) and `kL` (11 rows). Everything is converted to litres.
 *
 * The kL rows are the trap in this file. They carry quantities like `84.03`
 * against costs like `$152,369.51`. Loaded as litres they look like a small
 * delivery at an absurd price, and they under-report Scope 1 by roughly
 * 750,000 litres across the period — an error that produces a *lower* emissions
 * figure, which is exactly the direction nobody questions.
 */

const LITRES_PER_UNIT: Record<string, number> = {
  l: 1,
  lt: 1,
  litre: 1,
  litres: 1,
  kl: 1000,
  kilolitre: 1000,
  kilolitres: 1000,
};

export type NormalisedQuantity = {
  litres: number;
  /** The unit as written in the source, for the audit trail. */
  sourceUnit: string;
  /** 1 for litres, 1000 for kilolitres. Recorded per row. */
  conversionFactor: number;
};

export function normaliseQuantity(
  rawQuantity: string,
  rawUnit: string,
): Result<NormalisedQuantity> {
  const quantityText = rawQuantity.trim();
  const unitText = rawUnit.trim();

  if (quantityText === '') return err('quantity is empty');
  if (unitText === '') return err('unit is empty');

  const quantity = Number(quantityText.replace(/,/g, ''));
  if (!Number.isFinite(quantity)) {
    return err(`quantity is not a number: ${rawQuantity}`);
  }
  if (quantity === 0) {
    return err('quantity is zero');
  }

  const factor = LITRES_PER_UNIT[unitText.toLowerCase()];
  if (factor === undefined) {
    return err(`unknown fuel unit: ${rawUnit}`);
  }

  return ok({
    // Litres to two decimals: kL conversion is exact, and rounding here keeps
    // the value inside numeric(14,2) without surprising the database.
    litres: Math.round(quantity * factor * 100) / 100,
    sourceUnit: unitText,
    conversionFactor: factor,
  });
}

/**
 * Plausible delivered price per litre.
 *
 * Observed in this export: diesel $1.720-$1.937/L across 132 rows, petrol a
 * flat $1.850/L across 17. The band below is deliberately wider than that, so
 * ordinary price movement does not raise noise, while still catching the
 * failure this is actually here to catch: a missed kL conversion implies about
 * $1,800/L, and a stray factor of ten implies $18 or $0.18.
 *
 * Note the direction of the check. It validates the *relationship* between two
 * independently recorded columns, so it catches a unit error even when both the
 * quantity and the cost look individually reasonable.
 */
export const PLAUSIBLE_PRICE_BAND_AUD_PER_LITRE = { min: 1.0, max: 3.0 };

export function impliedPricePerLitre(
  costAud: number,
  litres: number,
): number | null {
  if (litres === 0) return null;
  // Credit notes carry a negative quantity against a negative cost; the implied
  // price is still positive and still worth checking.
  return costAud / litres;
}

export function isPricePlausible(pricePerLitre: number | null): boolean {
  if (pricePerLitre === null) return false;
  return (
    pricePerLitre >= PLAUSIBLE_PRICE_BAND_AUD_PER_LITRE.min &&
    pricePerLitre <= PLAUSIBLE_PRICE_BAND_AUD_PER_LITRE.max
  );
}
