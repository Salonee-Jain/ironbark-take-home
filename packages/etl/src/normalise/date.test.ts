import { describe, expect, it } from 'vitest';
import { normaliseDate, toMonthStart } from './date.js';

/**
 * Dates decide which month every emissions figure lands in, so a silent
 * misparse here moves tonnes of CO2e between reporting periods without
 * erroring. These tests exist for that failure, not for coverage.
 */

describe('normaliseDate', () => {
  it('parses the ISO format at day precision', () => {
    expect(normaliseDate('2025-12-19')).toEqual({
      ok: true,
      value: { iso: '2025-12-19', precision: 'day', format: 'iso' },
    });
  });

  it('reads slash dates day-first, as the source file writes them', () => {
    // The whole emissions series depends on this one choice. Under a
    // month-first reading this row would land in May instead of September.
    expect(normaliseDate('21/09/2025')).toEqual({
      ok: true,
      value: { iso: '2025-09-21', precision: 'day', format: 'day-first-slash' },
    });
  });

  it('accepts single-digit day and month', () => {
    const result = normaliseDate('5/9/2025');
    expect(result.ok && result.value.iso).toBe('2025-09-05');
  });

  it('anchors month-only dates to the first, and says the day is unknown', () => {
    expect(normaliseDate('Oct-25')).toEqual({
      ok: true,
      value: { iso: '2025-10-01', precision: 'month', format: 'month-year' },
    });
  });

  it('accepts full month names and any casing', () => {
    const result = normaliseDate('october-25');
    expect(result.ok && result.value.iso).toBe('2025-10-01');
  });

  it.each(['Jan-25', 'Feb-25', 'Mar-26', 'Apr-26', 'May-25', 'Jun-25', 'Jul-25',
           'Aug-25', 'Sep-25', 'Oct-25', 'Nov-25', 'Dec-25'])(
    'knows the month abbreviation %s',
    (value) => {
      expect(normaliseDate(value).ok).toBe(true);
    },
  );

  it('rejects a date that does not exist rather than rolling it over', () => {
    // Date() would silently turn 31/02 into 3 March. That is the bug this
    // guards: a rolled-over date is not an error anyone would notice.
    const result = normaliseDate('31/02/2026');
    expect(result.ok).toBe(false);
  });

  it('distinguishes a month-first date from a broken one', () => {
    // 05/21/2026 is not malformed, it is written the other way round, and the
    // remediation differs, so the message has to say which.
    const result = normaliseDate('05/21/2026');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('month-first');
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['Smarch-25', 'unknown month'],
    ['19 Dec 2025', 'unrecognised'],
    ['2025/12/19', 'unrecognised'],
    ['2025-13-01', 'not a real'],
  ])('rejects %s', (input) => {
    expect(normaliseDate(input).ok).toBe(false);
  });

  it('never returns a Date object', () => {
    // Timezone-free by construction: these values are bucketed into months and
    // rendered, and a Date would shift a day either side of UTC midnight.
    const result = normaliseDate('2025-12-19');
    expect(result.ok && typeof result.value.iso).toBe('string');
  });
});

describe('toMonthStart', () => {
  it('collapses a day to the first of its month', () => {
    expect(toMonthStart('2025-12-19')).toBe('2025-12-01');
  });

  it('leaves a first-of-month date alone', () => {
    expect(toMonthStart('2025-12-01')).toBe('2025-12-01');
  });
});
