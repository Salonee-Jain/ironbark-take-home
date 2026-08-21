-- Emissions roll-ups.
--
-- The per-activity view from 0005 is the source of truth; everything here is a
-- convenience shaped for a specific question the sustainability lead will ask.
-- Kept in SQL rather than assembled in the API so that the numbers on screen
-- and the numbers in a psql session cannot drift apart.

-- ---------------------------------------------------------------------------
-- One row per month: both scopes side by side, with month-on-month movement.
-- ---------------------------------------------------------------------------
create view v_monthly_emissions_totals as
with by_month as (
    select
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
    group by month
)
select
    month,
    scope1_kg_co2e,
    scope2_kg_co2e,
    total_kg_co2e,
    -- Share of the month's footprint that is Scope 1. The interesting series in
    -- this dataset: it is stable near 47% and then jumps to 79% in March 2026.
    round(
        case when total_kg_co2e = 0 then 0
             else scope1_kg_co2e / total_kg_co2e * 100 end,
        1
    )                                                        as scope1_share_pct,
    lag(total_kg_co2e) over (order by month)                 as previous_month_kg_co2e,
    round(
        case
            when lag(total_kg_co2e) over (order by month) is null then null
            when lag(total_kg_co2e) over (order by month) = 0 then null
            else (total_kg_co2e - lag(total_kg_co2e) over (order by month))
                 / lag(total_kg_co2e) over (order by month) * 100
        end,
        1
    )                                                        as month_on_month_pct,
    contributing_records,
    quality_issue_count,
    quality_error_count,
    has_quality_flags,
    has_imprecise_dates
from by_month;

-- Scope 1 by site area, and Scope 1 only. Fuel deliveries carry a site area; the
-- meters are described by function and never mapped to the site-area vocabulary
-- anywhere in the export, so a Scope 2 breakdown would be our guesswork.
create view v_scope1_by_site_area as
select
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
group by 1, 2, 3, 4;

-- Australian financial year. FY2026 runs July 2025 to June 2026 and is the only
-- complete year in this export, which is the unit an NGER report is filed
-- against. The partial FY2025 is included but marked incomplete, because a
-- six-month year shown next to a twelve-month one invites the wrong comparison.
create view v_financial_year_emissions as
select
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
group by 1;
