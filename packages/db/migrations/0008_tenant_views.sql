-- Rebuild the analytical views with company_id carried through.
--
-- The views are where tenancy is most likely to be got wrong, because a missing
-- `company_id` here does not fail — it silently sums every tenant's fuel into
-- one number and reports it with total confidence. Three things had to change,
-- and each is a distinct kind of mistake:
--
--   1. Every `group by` gains company_id, so aggregates stay within a tenant.
--   2. Every join gains company_id, including the data-quality lateral, which
--      previously matched on (source_file, source_row_number) — a pair that is
--      only unique inside one company's upload. Left alone it would have
--      attributed one tenant's corrections to another tenant's rows.
--   3. The month-on-month window gains `partition by company_id`, so the first
--      month of one company no longer computes a change against the last month
--      of whoever happened to sort before it.
--
-- Views are dropped newest-dependency-first and recreated in dependency order.

drop view if exists v_financial_year_emissions;
drop view if exists v_monthly_emissions_totals;
drop view if exists v_scope1_by_site_area;
drop view if exists v_monthly_emissions_by_scope;
drop view if exists v_monthly_emissions;
drop view if exists v_incident_monthly;

-- ---------------------------------------------------------------------------
-- Monthly emissions per activity
--
--   Scope 1 = litres burned      x factor  (diesel 2.70, petrol 2.31 kg CO2e/L)
--   Scope 2 = kWh from the grid  x factor  (0.71 kg CO2e/kWh)
--
-- Emission factors stay global reference data, so the join carries no
-- company_id: every tenant converts a litre of diesel the same way, and letting
-- them disagree would make two companies' reports incomparable for no reason.
-- ---------------------------------------------------------------------------
create view v_monthly_emissions as
with fuel as (
    select
        f.company_id                                          as company_id,
        date_trunc('month', f.delivery_date)::date            as month,
        ef.scope                                              as scope,
        ef.activity                                           as activity,
        ef.factor_key                                         as factor_key,
        sum(f.quantity_l)                                     as activity_amount,
        min(ef.unit)                                          as activity_unit,
        round(sum(f.quantity_l * ef.kg_co2e_per_unit), 2)     as kg_co2e,
        count(*)::integer                                     as contributing_records,
        sum(q.issue_count)::integer                           as quality_issue_count,
        sum(q.error_count)::integer                           as quality_error_count,
        bool_or(q.error_count > 0)                            as has_quality_flags,
        coalesce(bool_or(f.date_precision = 'month'), false)  as has_imprecise_dates
    from fuel_deliveries f
    join emission_factors ef on ef.factor_key = f.factor_key
    left join lateral (
        select
            count(*)::integer                                          as issue_count,
            count(*) filter (where q.severity = 'error')::integer      as error_count
        from data_quality_issues q
        where q.company_id = f.company_id
          and q.source_file = f.source_file
          and q.source_row_number = f.source_row_number
    ) q on true
    group by 1, 2, 3, 4, 5
),
electricity as (
    select
        r.company_id                                           as company_id,
        r.period                                               as month,
        ef.scope                                               as scope,
        ef.activity                                            as activity,
        ef.factor_key                                          as factor_key,
        sum(r.consumption_kwh)                                 as activity_amount,
        min(ef.unit)                                           as activity_unit,
        round(sum(r.consumption_kwh * ef.kg_co2e_per_unit), 2) as kg_co2e,
        count(*)::integer                                      as contributing_records,
        sum(q.issue_count)::integer                            as quality_issue_count,
        sum(q.error_count)::integer                            as quality_error_count,
        bool_or(q.error_count > 0)                             as has_quality_flags,
        false                                                  as has_imprecise_dates
    from electricity_readings r
    join emission_factors ef on ef.factor_key = 'grid_electricity_qld'
    left join lateral (
        select
            count(*)::integer                                          as issue_count,
            count(*) filter (where q.severity = 'error')::integer      as error_count
        from data_quality_issues q
        where q.company_id = r.company_id
          and q.source_file = r.source_file
          and q.source_row_number = r.source_row_number
    ) q on true
    group by 1, 2, 3, 4, 5
)
select * from fuel
union all
select * from electricity;

-- ---------------------------------------------------------------------------
-- One row per company per month per scope.
-- ---------------------------------------------------------------------------
create view v_monthly_emissions_by_scope as
select
    company_id,
    month,
    scope,
    round(sum(kg_co2e), 2)          as kg_co2e,
    sum(contributing_records)       as contributing_records,
    sum(quality_issue_count)        as quality_issue_count,
    sum(quality_error_count)        as quality_error_count,
    bool_or(has_quality_flags)      as has_quality_flags,
    bool_or(has_imprecise_dates)    as has_imprecise_dates
from v_monthly_emissions
group by company_id, month, scope;

-- ---------------------------------------------------------------------------
-- One row per company per month: both scopes side by side, with month-on-month
-- movement.
-- ---------------------------------------------------------------------------
create view v_monthly_emissions_totals as
with by_month as (
    select
        company_id,
        month,
        round(coalesce(sum(kg_co2e) filter (where scope = 1), 0), 2) as scope1_kg_co2e,
        round(coalesce(sum(kg_co2e) filter (where scope = 2), 0), 2) as scope2_kg_co2e,
        round(sum(kg_co2e), 2)                                       as total_kg_co2e,
        sum(contributing_records)::integer                           as contributing_records,
        sum(quality_issue_count)::integer                            as quality_issue_count,
        sum(quality_error_count)::integer                            as quality_error_count,
        bool_or(has_quality_flags)                                   as has_quality_flags,
        bool_or(has_imprecise_dates)                                 as has_imprecise_dates
    from v_monthly_emissions
    group by company_id, month
)
select
    company_id,
    month,
    scope1_kg_co2e,
    scope2_kg_co2e,
    total_kg_co2e,
    -- Share of the month's footprint that is Scope 1. The interesting series in
    -- the demo dataset: stable near 47%, then a jump to 79% in March 2026.
    round(
        case when total_kg_co2e = 0 then 0
             else scope1_kg_co2e / total_kg_co2e * 100 end,
        1
    )                                                        as scope1_share_pct,
    lag(total_kg_co2e) over w                                as previous_month_kg_co2e,
    round(
        case
            when lag(total_kg_co2e) over w is null then null
            when lag(total_kg_co2e) over w = 0 then null
            else (total_kg_co2e - lag(total_kg_co2e) over w)
                 / lag(total_kg_co2e) over w * 100
        end,
        1
    )                                                        as month_on_month_pct,
    contributing_records,
    quality_issue_count,
    quality_error_count,
    has_quality_flags,
    has_imprecise_dates
from by_month
-- Named window: the same frame is referenced five times, and a partition clause
-- that has to be repeated is a partition clause that will eventually be
-- repeated wrongly.
window w as (partition by company_id order by month);

-- ---------------------------------------------------------------------------
-- Scope 1 by site area.
--
-- Scope 1 only, and deliberately so. Fuel deliveries carry a site area; the
-- electricity meters are described by function ('CHPP Conveyors', 'Admin &
-- Camp') and are never mapped to the site-area vocabulary anywhere in the
-- export. Inventing that mapping would produce a confident site breakdown of
-- Scope 2 built on our guesswork, so the view reports what the data supports
-- and no more.
--
-- The site_areas join is unscoped on purpose: `site_area_id` already points at
-- either a global row or a row belonging to this company, and the loader is
-- what enforces that. Adding a company predicate here would drop the six shared
-- taxonomy rows and leave every site area reading '(unrecorded)'.
-- ---------------------------------------------------------------------------
create view v_scope1_by_site_area as
select
    f.company_id                                      as company_id,
    date_trunc('month', f.delivery_date)::date        as month,
    coalesce(sa.name, '(unrecorded)')                 as site_area,
    coalesce(sa.category, 'unknown')                  as site_area_category,
    f.fuel_type                                       as fuel_type,
    sum(f.quantity_l)                                 as litres,
    round(sum(f.quantity_l * ef.kg_co2e_per_unit), 2) as kg_co2e,
    count(*)::integer                                 as delivery_count
from fuel_deliveries f
join emission_factors ef on ef.factor_key = f.factor_key
left join site_areas sa on sa.id = f.site_area_id
group by 1, 2, 3, 4, 5;

-- ---------------------------------------------------------------------------
-- Australian financial year.
--
-- FY2026 runs 1 July 2025 to 30 June 2026, and the demo export covers it in
-- full — the only complete financial year in that data, and the unit an NGER
-- report is actually filed against. A partial year is included but marked
-- incomplete, because presenting a six-month year next to a twelve-month one
-- without saying so invites exactly the wrong comparison.
-- ---------------------------------------------------------------------------
create view v_financial_year_emissions as
select
    company_id,
    case
        when extract(month from month) >= 7 then extract(year from month) + 1
        else extract(year from month)
    end::integer                                                 as financial_year,
    round(coalesce(sum(scope1_kg_co2e), 0), 2)                   as scope1_kg_co2e,
    round(coalesce(sum(scope2_kg_co2e), 0), 2)                   as scope2_kg_co2e,
    round(sum(total_kg_co2e), 2)                                 as total_kg_co2e,
    count(*)::integer                                            as months_with_data,
    count(*) = 12                                                as is_complete_year,
    min(month)                                                   as first_month,
    max(month)                                                   as last_month,
    sum(quality_error_count)::integer                            as quality_error_count
from v_monthly_emissions_totals
group by company_id, 2;

-- ---------------------------------------------------------------------------
-- Incident counts by month, type and severity.
-- ---------------------------------------------------------------------------
create view v_incident_monthly as
select
    i.company_id                               as company_id,
    date_trunc('month', i.incident_date)::date as month,
    i.type_code                                as type_code,
    t.label                                    as type_label,
    i.severity                                 as severity,
    count(*)::integer                          as incident_count
from incidents i
left join incident_types t on t.code = i.type_code
group by 1, 2, 3, 4, 5;
