-- Replace the boolean quality flag on the emissions views with counts.
--
-- A second migration rather than an edit to 0004, because migrations are
-- immutable once applied and the runner enforces it by checksum.
--
-- `has_quality_flags` was true whenever any contributing row had any issue,
-- which against the real data is all 18 months: the 29 month-only fuel dates
-- alone cover the period. A flag that is always on tells a user nothing. Counts
-- by severity let the UI say something specific, and the flag survives with a
-- stricter meaning: at least one error-severity issue.

drop view if exists v_monthly_emissions_by_scope;
drop view if exists v_monthly_emissions;

create view v_monthly_emissions as
with fuel as (
    select
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
        where q.source_file = f.source_file
          and q.source_row_number = f.source_row_number
    ) q on true
    group by 1, 2, 3, 4
),
electricity as (
    select
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
        where q.source_file = r.source_file
          and q.source_row_number = r.source_row_number
    ) q on true
    group by 1, 2, 3, 4
)
select * from fuel
union all
select * from electricity;

create view v_monthly_emissions_by_scope as
select
    month,
    scope,
    round(sum(kg_co2e), 2)          as kg_co2e,
    sum(contributing_records)       as contributing_records,
    sum(quality_issue_count)        as quality_issue_count,
    sum(quality_error_count)        as quality_error_count,
    bool_or(has_quality_flags)      as has_quality_flags,
    bool_or(has_imprecise_dates)    as has_imprecise_dates
from v_monthly_emissions
group by month, scope;
