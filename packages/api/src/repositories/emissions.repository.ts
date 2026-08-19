import { getPool } from '@ironbark/db';

/**
 * Emissions data access.
 *
 * All SQL for this domain lives here and nowhere else. Two reasons that matter
 * beyond tidiness: the queries are reviewable as a set, and a service can be
 * tested against a fake repository without a database.
 *
 * Repositories return rows as the database shapes them — snake_case, no derived
 * fields. Interpretation is the service's job.
 *
 * **Tenancy.** `companyId` is the first parameter of every function here and
 * `$1` of every statement, without exception and without a default. That is
 * deliberately monotonous: a company filter that is sometimes optional is a
 * company filter that will sometimes be omitted, and the failure mode is not an
 * error — it is one client's fuel silently added to another client's report.
 * The value only ever comes from the verified session cookie.
 */

export type MonthlyEmissionsRow = {
  month: string;
  scope1_kg_co2e: number;
  scope2_kg_co2e: number;
  total_kg_co2e: number;
  scope1_share_pct: number;
  month_on_month_pct: number | null;
  contributing_records: number;
  quality_issue_count: number;
  quality_error_count: number;
  has_quality_flags: boolean;
  has_imprecise_dates: boolean;
};

export type ActivityBreakdownRow = {
  month: string;
  scope: number;
  activity: string;
  factor_key: string;
  activity_amount: number;
  activity_unit: string;
  kg_co2e: number;
  contributing_records: number;
  has_imprecise_dates: boolean;
};

export type SiteAreaRow = {
  site_area: string;
  site_area_category: string;
  fuel_type: string;
  litres: number;
  kg_co2e: number;
  delivery_count: number;
};

export type PeriodTotalsRow = {
  scope1_kg_co2e: number;
  scope2_kg_co2e: number;
  total_kg_co2e: number;
  months: number;
  first_month: string | null;
  last_month: string | null;
  quality_error_count: number;
};

export type FinancialYearRow = {
  financial_year: number;
  scope1_kg_co2e: number;
  scope2_kg_co2e: number;
  total_kg_co2e: number;
  months_with_data: number;
  is_complete_year: boolean;
  first_month: string;
  last_month: string;
};

export type ExtremeMonthRow = {
  month: string;
  total_kg_co2e: number;
  kind: 'highest' | 'lowest';
};

/** Inclusive month bounds as `YYYY-MM-01`, or null for open-ended. */
export type MonthRange = { from: string | null; to: string | null };

export async function findMonthlyTotals(
  companyId: number,
  range: MonthRange,
): Promise<MonthlyEmissionsRow[]> {
  const { rows } = await getPool().query<MonthlyEmissionsRow>(
    `select
       to_char(month, 'YYYY-MM') as month,
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
     where company_id = $1
       and ($2::date is null or month >= $2::date)
       and ($3::date is null or month <= $3::date)
     order by month`,
    [companyId, range.from, range.to],
  );
  return rows;
}

export async function findActivityBreakdown(
  companyId: number,
  range: MonthRange,
): Promise<ActivityBreakdownRow[]> {
  const { rows } = await getPool().query<ActivityBreakdownRow>(
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
     where company_id = $1
       and ($2::date is null or month >= $2::date)
       and ($3::date is null or month <= $3::date)
     order by month, scope, activity`,
    [companyId, range.from, range.to],
  );
  return rows;
}

export async function findScope1BySiteArea(
  companyId: number,
  range: MonthRange,
): Promise<SiteAreaRow[]> {
  const { rows } = await getPool().query<SiteAreaRow>(
    `select
       site_area,
       site_area_category,
       fuel_type,
       sum(litres)         as litres,
       sum(kg_co2e)        as kg_co2e,
       sum(delivery_count) as delivery_count
     from v_scope1_by_site_area
     where company_id = $1
       and ($2::date is null or month >= $2::date)
       and ($3::date is null or month <= $3::date)
     group by site_area, site_area_category, fuel_type
     order by sum(kg_co2e) desc`,
    [companyId, range.from, range.to],
  );
  return rows;
}

/**
 * Period totals.
 *
 * Unfiltered by month on purpose: this is the headline for the whole export,
 * and a figure that silently moved when someone dragged a date filter would be
 * the wrong kind of responsive. The filtered equivalent is the sum of
 * `findMonthlyTotals`.
 */
export async function findPeriodTotals(
  companyId: number,
): Promise<PeriodTotalsRow | undefined> {
  const { rows } = await getPool().query<PeriodTotalsRow>(
    `select
       sum(scope1_kg_co2e)            as scope1_kg_co2e,
       sum(scope2_kg_co2e)            as scope2_kg_co2e,
       sum(total_kg_co2e)             as total_kg_co2e,
       count(*)                       as months,
       to_char(min(month), 'YYYY-MM') as first_month,
       to_char(max(month), 'YYYY-MM') as last_month,
       sum(quality_error_count)       as quality_error_count
     from v_monthly_emissions_totals
     where company_id = $1`,
    [companyId],
  );
  return rows[0];
}

export async function findFinancialYears(
  companyId: number,
): Promise<FinancialYearRow[]> {
  const { rows } = await getPool().query<FinancialYearRow>(
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
     where company_id = $1
     order by financial_year`,
    [companyId],
  );
  return rows;
}

export async function findExtremeMonths(
  companyId: number,
): Promise<ExtremeMonthRow[]> {
  const { rows } = await getPool().query<ExtremeMonthRow>(
    `(select to_char(month,'YYYY-MM') as month, total_kg_co2e, 'highest' as kind
        from v_monthly_emissions_totals where company_id = $1
        order by total_kg_co2e desc limit 1)
     union all
     (select to_char(month,'YYYY-MM'), total_kg_co2e, 'lowest'
        from v_monthly_emissions_totals where company_id = $1
        order by total_kg_co2e asc limit 1)`,
    [companyId],
  );
  return rows;
}
