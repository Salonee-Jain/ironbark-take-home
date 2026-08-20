import { describe, expect, it } from 'vitest';
import {
  impliedPricePerLitre,
  isPricePlausible,
  normaliseQuantity,
} from './quantity.js';

/**
 * The kL rows are the most expensive defect in the export: loaded unconverted
 * they under-report Scope 1 by ~750,000 litres, and they do it in the direction
 * that produces a *lower* emissions number — the direction nobody questions.
 */

describe('normaliseQuantity', () => {
  it.each(['L', 'l', 'litres', 'Litres', 'LITRES'])(
    'treats %s as litres, factor 1',
    (unit) => {
      expect(normaliseQuantity('12500', unit)).toEqual({
        ok: true,
        value: { litres: 12500, sourceUnit: unit, conversionFactor: 1 },
      });
    },
  );

  it.each(['kL', 'kl', 'KL', 'kilolitres'])(
    'converts %s to litres at 1000',
    (unit) => {
      const result = normaliseQuantity('84.03', unit);
      expect(result.ok && result.value.litres).toBe(84030);
      expect(result.ok && result.value.conversionFactor).toBe(1000);
    },
  );

  it('strips thousands separators', () => {
    const result = normaliseQuantity('12,500', 'L');
    expect(result.ok && result.value.litres).toBe(12500);
  });

  it('keeps a negative quantity, because the credit note is one', () => {
    // INV-41777 is -12,500 L. Rejecting negatives here would drop the one row
    // that nets Scope 1 down.
    const result = normaliseQuantity('-12500', 'L');
    expect(result.ok && result.value.litres).toBe(-12500);
  });

  it.each([
    ['', 'L', 'empty quantity'],
    ['12500', '', 'empty unit'],
    ['0', 'L', 'zero'],
    ['abc', 'L', 'not a number'],
    ['12500', 'gallons', 'unknown unit'],
  ])('rejects (%s, %s)', (quantity, unit) => {
    expect(normaliseQuantity(quantity, unit).ok).toBe(false);
  });

  it('never loses the original value: litres / factor recovers the input', () => {
    // The property the compliance requirement actually rests on — every
    // normalised number must be reversible to the cell it came from.
    const cases: [string, string][] = [
      ['12500', 'L'],
      ['84.03', 'kL'],
      ['9,876.54', 'litres'],
      ['-12500', 'L'],
      ['0.01', 'kL'],
    ];

    for (const [quantity, unit] of cases) {
      const result = normaliseQuantity(quantity, unit);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const original = Number(quantity.replace(/,/g, ''));
      expect(result.value.litres / result.value.conversionFactor).toBeCloseTo(
        original,
        6,
      );
      expect(result.value.sourceUnit).toBe(unit);
    }
  });
});

describe('implied price cross-check', () => {
  it('accepts a normal delivered price', () => {
    // 12,500 L at $23,375 -> $1.87/L, mid-band.
    expect(isPricePlausible(impliedPricePerLitre(23375, 12500))).toBe(true);
  });

  it('catches a kL row loaded as if it were litres', () => {
    // The defect this check exists for: 84.03 "litres" against $152,369.51
    // implies ~$1,813/L. Both columns look individually reasonable; only the
    // relationship between them gives it away.
    const price = impliedPricePerLitre(152369.51, 84.03);
    expect(isPricePlausible(price)).toBe(false);
  });

  it('catches a stray factor of ten in either direction', () => {
    expect(isPricePlausible(impliedPricePerLitre(23375, 1250))).toBe(false);
    expect(isPricePlausible(impliedPricePerLitre(23375, 125000))).toBe(false);
  });

  it('reads a credit note as a positive price', () => {
    // Negative quantity against negative cost — still $1.87/L, still checkable.
    const price = impliedPricePerLitre(-23375, -12500);
    expect(price).toBeCloseTo(1.87, 2);
    expect(isPricePlausible(price)).toBe(true);
  });

  it('returns null rather than dividing by zero', () => {
    expect(impliedPricePerLitre(100, 0)).toBeNull();
    expect(isPricePlausible(null)).toBe(false);
  });
});
