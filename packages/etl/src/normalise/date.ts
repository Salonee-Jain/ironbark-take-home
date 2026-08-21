import type { DatePrecision } from '@ironbark/shared';
import { err, ok, type Result } from './result.js';

/**
 * Date normalisation. Three formats share one column: ISO, day-first slash, and
 * month-year.
 *
 * Day-first is established from the data rather than assumed from the locale:
 * across all 142 slash-formatted dates the second component never exceeds 12
 * while the first reaches 30. A month-first misreading would move about 40% of
 * deliveries into the wrong month without erroring.
 *
 * Dates stay strings, never Date objects. The only thing done with them is
 * bucketing into months, and an ISO string has no timezone to get wrong.
 */

export type DateFormat = 'iso' | 'day-first-slash' | 'month-year';

export type NormalisedDate = {
  /** `YYYY-MM-DD`. Month-only sources are anchored to the first of the month. */
  iso: string;
  precision: DatePrecision;
  format: DateFormat;
};

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Reject dates that look well-formed but do not exist (31/02, 31/04).
 * Round-tripping through UTC catches the rollover Date performs silently.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function toIso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Expand a two-digit year.
 *
 * Everything in this export is 25 or 26, so a simple 2000-pivot is safe and
 * honest. A wider pivot would be inventing a rule the data cannot justify.
 */
function expandTwoDigitYear(yy: number): number {
  return 2000 + yy;
}

export function normaliseDate(raw: string): Result<NormalisedDate> {
  const value = raw.trim();
  if (value === '') return err('date is empty');

  // 2025-12-19
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!isRealDate(year, month, day)) {
      return err(`ISO date is not a real calendar date: ${value}`);
    }
    return ok({
      iso: toIso(year, month, day),
      precision: 'day',
      format: 'iso',
    });
  }

  // 21/05/2026  (day first, see the note above)
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) {
    const [day, month, year] = [
      Number(slash[1]),
      Number(slash[2]),
      Number(slash[3]),
    ];
    if (!isRealDate(year, month, day)) {
      // Worth distinguishing: a value like 05/21/2026 is not a broken date,
      // it is a date written the other way round, and the fix is different.
      const monthFirstWouldWork = isRealDate(year, day, month);
      return err(
        monthFirstWouldWork
          ? `not a valid day-first date: ${value} (parses only as month-first, which contradicts the rest of the file)`
          : `not a real calendar date: ${value}`,
      );
    }
    return ok({
      iso: toIso(year, month, day),
      precision: 'day',
      format: 'day-first-slash',
    });
  }

  // Oct-25
  const monthYear = /^([A-Za-z]{3,9})-(\d{2})$/.exec(value);
  if (monthYear) {
    const key = monthYear[1]!.slice(0, 3).toLowerCase();
    const month = MONTH_ABBREVIATIONS[key];
    if (month === undefined) return err(`unknown month name: ${value}`);

    const year = expandTwoDigitYear(Number(monthYear[2]));
    return ok({
      // Anchored to the first of the month. The day is genuinely unknown, and
      // `precision` says so rather than letting a made-up day look real.
      iso: toIso(year, month, 1),
      precision: 'month',
      format: 'month-year',
    });
  }

  return err(`unrecognised date format: ${value}`);
}

/** `YYYY-MM-DD` -> `YYYY-MM-01`, for monthly bucketing. */
export function toMonthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
