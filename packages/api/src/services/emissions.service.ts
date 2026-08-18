import * as repository from '../repositories/emissions.repository.js';
import { camelCaseRows } from '../utils/case.js';

/**
 * Emissions business logic.
 *
 * Thin by design. The arithmetic is in SQL views so that the API and a psql
 * session cannot disagree, which leaves this layer responsible for shaping,
 * defaults, and the judgements that are not the database's to make — such as
 * what to say when a figure the client expects cannot honestly be produced.
 */

/** `2026-03` -> `2026-03-01`, the anchor every monthly view uses. */
function toMonthStart(month: string | undefined): string | null {
  return month ? `${month}-01` : null;
}

export async function getMonthlyEmissions(range: {
  from?: string;
  to?: string;
}) {
  const rows = await repository.findMonthlyTotals(
    toMonthStart(range.from),
    toMonthStart(range.to),
  );
  return { months: camelCaseRows(rows) };
}

export async function getActivityBreakdown() {
  return { activities: camelCaseRows(await repository.findActivityBreakdown()) };
}

export async function getScope1BySiteArea() {
  return {
    scope: 1 as const,
    siteAreas: camelCaseRows(await repository.findScope1BySiteArea()),
    note:
      'Scope 1 only. Fuel deliveries record a site area; the electricity meters are described by ' +
      'function and are never mapped to the site-area vocabulary anywhere in the source, so a Scope 2 ' +
      'site breakdown would be our guesswork rather than client data.',
  };
}

export async function getSummary() {
  const [totals, financialYears, extremes] = await Promise.all([
    repository.findPeriodTotals(),
    repository.findFinancialYears(),
    repository.findExtremeMonths(),
  ]);

  return {
    period: {
      firstMonth: totals?.first_month ?? null,
      lastMonth: totals?.last_month ?? null,
      months: totals?.months ?? 0,
      scope1KgCo2e: totals?.scope1_kg_co2e ?? 0,
      scope2KgCo2e: totals?.scope2_kg_co2e ?? 0,
      totalKgCo2e: totals?.total_kg_co2e ?? 0,
      qualityErrorCount: totals?.quality_error_count ?? 0,
    },
    financialYears: camelCaseRows(financialYears),
    extremes: camelCaseRows(extremes),
    // Stated rather than omitted. A sustainability lead will look for intensity
    // first, and its absence needs an explanation rather than a blank tile.
    intensity: {
      available: false,
      reason:
        'No production data in this export — no tonnes moved, no operating hours — so emissions ' +
        'intensity cannot be derived. Reporting a denominator we invented would be worse than reporting none.',
    },
  };
}
