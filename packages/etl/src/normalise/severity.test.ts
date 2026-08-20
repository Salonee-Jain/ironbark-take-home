import { describe, expect, it } from 'vitest';
import { normaliseSeverity } from './severity.js';

/**
 * The register mixes two severity scales in one column. The mapping is an
 * assumption (Low=1, Medium=2, High=3), so `scale` is returned alongside the
 * value — the loader raises the mixed-scale problem as its own data-quality
 * issue rather than letting the normalisation quietly settle the question.
 */

describe('normaliseSeverity', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['3', 3],
  ])('passes numeric %s through', (raw, expected) => {
    expect(normaliseSeverity(raw)).toEqual({
      ok: true,
      value: { severity: expected, scale: 'numeric' },
    });
  });

  it.each([
    ['Low', 1],
    ['Medium', 2],
    ['High', 3],
  ])('maps %s onto the numeric scale', (raw, expected) => {
    expect(normaliseSeverity(raw)).toEqual({
      ok: true,
      value: { severity: expected, scale: 'ordinal-text' },
    });
  });

  it.each(['low', 'LOW', '  Low  '])('is case and space insensitive: %s', (raw) => {
    const result = normaliseSeverity(raw);
    expect(result.ok && result.value.severity).toBe(1);
  });

  it('reports which scale each value came from', () => {
    // This is what lets the loader see that both scales are in use at once.
    const numeric = normaliseSeverity('2');
    const ordinal = normaliseSeverity('Medium');

    expect(numeric).toEqual({
      ok: true,
      value: { severity: 2, scale: 'numeric' },
    });
    expect(ordinal).toEqual({
      ok: true,
      value: { severity: 2, scale: 'ordinal-text' },
    });
  });

  it.each(['0', '4', '10', '-1', 'Critical', 'Severe', '', '   ', 'N/A'])(
    'rejects %s rather than clamping it into the scale',
    (raw) => {
      expect(normaliseSeverity(raw).ok).toBe(false);
    },
  );
});
