import { err, ok, type Result } from './result.js';

/**
 * Fuel quantity normalisation. The unit column uses four spellings for two
 * units, all converted to litres. The 11 kL rows are the trap: loaded as litres
 * they under-report Scope 1 by roughly 750,000 litres, an error in the direction
 * nobody questions.
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
 * Plausible delivered price per litre. Observed $1.72 to $1.94; the band is
 * wider so ordinary price movement is not noise, while still catching a missed
 * kL conversion, which implies about $1,800/L.
 *
 * It validates the relationship between two independently recorded columns, so
 * it catches a unit error even when the quantity and the cost each look
 * reasonable alone.
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
