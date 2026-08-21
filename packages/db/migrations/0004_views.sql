-- Analytical views.
--
-- The emissions calculation lives in SQL rather than application code so that a
-- reviewer can read the arithmetic, and so the API cannot quietly disagree with
-- what a `psql` session reports.

-- Monthly emissions by scope.
--
--   Scope 1 = litres burned x factor (diesel 2.70, petrol 2.31 kg CO2e/L)
--   Scope 2 = kWh from the grid x factor (0.71 kg CO2e/kWh)
--
-- The credit note carries a negative quantity, so `sum` nets it off: leaving it
-- in would overstate Scope 1 by 12,500 L. `has_quality_flags` marks any month
-- drawing on a record we corrected or flagged, because a chart that cannot say
-- which bars rest on shaky data looks equally confident everywhere.
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
        coalesce(bool_or(q.flagged), false)                   as has_quality_flags,
        -- Monthly totals stay valid when the day is unknown, but say so.
        coalesce(bool_or(f.date_precision = 'month'), false)  as has_imprecise_dates
    from fuel_deliveries f
    join emission_factors ef on ef.factor_key = f.factor_key
    left join lateral (
        select true as flagged
        from data_quality_issues q
        where q.source_file = f.source_file
          and q.source_row_number = f.source_row_number
        limit 1
    ) q on true
    group by 1, 2, 3, 4
),
electricity as (
    select
        r.period                                              as month,
        ef.scope                                              as scope,
        ef.activity                                           as activity,
        ef.factor_key                                         as factor_key,
        sum(r.consumption_kwh)                                as activity_amount,
        min(ef.unit)                                          as activity_unit,
        round(sum(r.consumption_kwh * ef.kg_co2e_per_unit), 2) as kg_co2e,
        count(*)::integer                                     as contributing_records,
        coalesce(bool_or(q.flagged), false)                   as has_quality_flags,
        false                                                 as has_imprecise_dates
    from electricity_readings r
    join emission_factors ef on ef.factor_key = 'grid_electricity_qld'
    left join lateral (
        select true as flagged
        from data_quality_issues q
        where q.source_file = r.source_file
          and q.source_row_number = r.source_row_number
        limit 1
    ) q on true
    group by 1, 2, 3, 4
)
select * from fuel
union all
select * from electricity;

-- ---------------------------------------------------------------------------
-- Monthly emissions rolled up to one row per month per scope.
-- ---------------------------------------------------------------------------
create view v_monthly_emissions_by_scope as
select
    month,
    scope,
    round(sum(kg_co2e), 2)      as kg_co2e,
    sum(contributing_records)   as contributing_records,
    bool_or(has_quality_flags)  as has_quality_flags
from v_monthly_emissions
group by month, scope;

-- ---------------------------------------------------------------------------
-- Incident counts by month, type and severity.
-- ---------------------------------------------------------------------------
create view v_incident_monthly as
select
    date_trunc('month', i.incident_date)::date as month,
    i.type_code                                as type_code,
    t.label                                    as type_label,
    i.severity                                 as severity,
    count(*)::integer                          as incident_count
from incidents i
left join incident_types t on t.code = i.type_code
group by 1, 2, 3, 4;
