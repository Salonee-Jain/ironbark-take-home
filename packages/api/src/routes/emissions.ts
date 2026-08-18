import { getPool } from '@ironbark/db';
import type { FastifyInstance } from 'fastify';

/**
 * Emissions endpoints.
 *
 * Every figure served here comes from a view, not from arithmetic in this
 * layer. The API's job is to shape and filter, never to compute — if a number
 * on screen disagrees with the same query in psql, that is a bug we should be
 * unable to write.
 */

const MONTH_PATTERN = '^\\d{4}-\\d{2}$';

type MonthRangeQuery = { from?: string; to?: string };

/** `2026-03` -> `2026-03-01`, the anchor every monthly view uses. */
function toMonthStart(month: string): string {
  return `${month}-01`;
}

export async function emissionsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: MonthRangeQuery }>(
    '/api/emissions/monthly',
    {
      schema: {
        tags: ['emissions'],
        summary: 'Monthly emissions by scope',
        description:
          'Scope 1 (fuel combustion) and Scope 2 (grid electricity) per month, in kg CO2e, ' +
          'computed from cleaned activity data and the supplied emission factors. ' +
          'Each month carries the number of source records behind it and how many of those ' +
          'required a data-quality correction.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', pattern: MONTH_PATTERN, examples: ['2025-07'] },
            to: { type: 'string', pattern: MONTH_PATTERN, examples: ['2026-06'] },
          },
        },
      },
    },
    async (request) => {
      const { from, to } = request.query;

      const { rows } = await getPool().query(
        `select
           to_char(month, 'YYYY-MM')   as month,
           scope1_kg_co2e,
           scope2_kg_co2e,
           total_kg_co2e,
           scope1_share_pct,
           month_on_month_pct,
           contributing_records,
           quality_issue_count,
           quality_error_count,
           has_quality_flags,
           has_imprecise_dates
         from v_monthly_emissions_totals
         where ($1::date is null or month >= $1::date)
           and ($2::date is null or month <= $2::date)
         order by month`,
        [from ? toMonthStart(from) : null, to ? toMonthStart(to) : null],
      );

      return { months: rows };
    },
  );

  app.get(
    '/api/emissions/breakdown',
    {
      schema: {
        tags: ['emissions'],
        summary: 'Emissions by activity',
        description:
          'The per-activity rows behind the monthly totals: diesel, petrol and grid electricity, ' +
          'with the activity amount and unit alongside the resulting kg CO2e.',
      },
    },
    async () => {
      const { rows } = await getPool().query(
        `select
           to_char(month, 'YYYY-MM') as month,
           scope,
           activity,
           factor_key,
           activity_amount,
           activity_unit,
           kg_co2e,
           contributing_records,
           has_imprecise_dates
         from v_monthly_emissions
         order by month, scope, activity`,
      );

      return { activities: rows };
    },
  );

  app.get(
    '/api/emissions/by-site-area',
    {
      schema: {
        tags: ['emissions'],
        summary: 'Scope 1 by site area',
        description:
          'Scope 1 only. Fuel deliveries record a site area; the electricity meters are described ' +
          'by function and are never mapped to the site-area vocabulary anywhere in the source, so ' +
          'a Scope 2 site breakdown would be our guesswork rather than the client data.',
      },
    },
    async () => {
      const { rows } = await getPool().query(
        `select
           site_area,
           site_area_category,
           fuel_type,
           sum(litres)          as litres,
           sum(kg_co2e)         as kg_co2e,
           sum(delivery_count)  as delivery_count
         from v_scope1_by_site_area
         group by site_area, site_area_category, fuel_type
         order by sum(kg_co2e) desc`,
      );

      return { scope: 1, siteAreas: rows };
    },
  );

  app.get(
    '/api/emissions/summary',
    {
      schema: {
        tags: ['emissions'],
        summary: 'Period and financial-year totals',
        description:
          'Headline totals for the whole export and per Australian financial year. ' +
          'FY2026 (Jul 2025 - Jun 2026) is the only complete year in this data; partial years ' +
          'are returned with isCompleteYear false so they are not compared as if whole.',
      },
    },
    async () => {
      const pool = getPool();

      const [totals, financialYears, extremes] = await Promise.all([
        pool.query(
          `select
             sum(scope1_kg_co2e)      as scope1_kg_co2e,
             sum(scope2_kg_co2e)      as scope2_kg_co2e,
             sum(total_kg_co2e)       as total_kg_co2e,
             count(*)                          as months,
             to_char(min(month), 'YYYY-MM')    as first_month,
             to_char(max(month), 'YYYY-MM')    as last_month,
             sum(quality_error_count) as quality_error_count
           from v_monthly_emissions_totals`,
        ),
        pool.query(
          `select
             financial_year,
             scope1_kg_co2e,
             scope2_kg_co2e,
             total_kg_co2e,
             months_with_data,
             is_complete_year,
             to_char(first_month, 'YYYY-MM') as first_month,
             to_char(last_month, 'YYYY-MM')  as last_month
           from v_financial_year_emissions
           order by financial_year`,
        ),
        // The single most and least carbon-intensive months, which is what a
        // reader looks for first and would otherwise eyeball off a chart.
        pool.query(
          `(select to_char(month,'YYYY-MM') as month, total_kg_co2e, 'highest' as kind
              from v_monthly_emissions_totals order by total_kg_co2e desc limit 1)
           union all
           (select to_char(month,'YYYY-MM'), total_kg_co2e, 'lowest'
              from v_monthly_emissions_totals order by total_kg_co2e asc limit 1)`,
        ),
      ]);

      const summary = totals.rows[0];

      return {
        period: {
          firstMonth: summary?.first_month ?? null,
          lastMonth: summary?.last_month ?? null,
          months: summary?.months ?? 0,
          scope1KgCo2e: summary?.scope1_kg_co2e ?? 0,
          scope2KgCo2e: summary?.scope2_kg_co2e ?? 0,
          totalKgCo2e: summary?.total_kg_co2e ?? 0,
          qualityErrorCount: summary?.quality_error_count ?? 0,
        },
        financialYears: financialYears.rows,
        extremes: extremes.rows,
        // Stated rather than omitted: a sustainability lead will look for
        // intensity, and its absence needs an explanation, not a blank tile.
        intensity: {
          available: false,
          reason:
            'No production data in this export — no tonnes moved, no operating hours — so emissions ' +
            'intensity cannot be derived. Reporting a denominator we invented would be worse than reporting none.',
        },
      };
    },
  );
}
