import { getPool } from '@ironbark/db';

/**
 * Data access for the cross-dataset correlation view.
 *
 * The queries here are deliberately dumb: each one fetches one dataset's monthly
 * shape and nothing else. The *joining* — the part that turns three unrelated
 * series into a causal account — happens in the service, in TypeScript, where it
 * can be read and argued with.
 *
 * That is the opposite of the choice made for emissions, where the arithmetic
 * lives in SQL. The reason for the difference: an emissions total is a sum, and
 * a sum belongs next to the data. A claim that one event caused another is an
 * interpretation, and an interpretation should be somewhere a reviewer can see
 * every assumption that went into it.
 *
 * **Tenancy.** `companyId` is `$1` of every statement here, as everywhere else.
 */

export type MonthlyElectricityRow = {
  month: string;
  consumption_kwh: number;
  meter_count: number;
};

export type MeterMonthRow = {
  meter_id: string;
  description: string | null;
  consumption_kwh: number;
};

export type MonthlyFuelRow = {
  month: string;
  litres: number;
  delivery_count: number;
};

export type OutageIncidentRow = {
  id: string;
  incident_date: string;
  location_raw: string;
  type_code: string;
  severity: number | null;
  description: string;
  ai_category: string | null;
  ai_is_psychosocial: boolean | null;
  ai_evidence_quote: string | null;
};

/** Site-wide grid consumption per month, and how many meters contributed. */
export async function findMonthlyElectricity(
  companyId: number,
): Promise<MonthlyElectricityRow[]> {
  const { rows } = await getPool().query<MonthlyElectricityRow>(
    `select to_char(period, 'YYYY-MM')          as month,
            sum(consumption_kwh)                as consumption_kwh,
            count(distinct meter_id)::integer   as meter_count
     from electricity_readings
     where company_id = $1
     group by period
     order by period`,
    [companyId],
  );
  return rows;
}

export type MeterHistoryRow = {
  meter_id: string;
  month: string;
  consumption_kwh: number;
};

/**
 * Every meter's full history.
 *
 * Needed because each meter has to be judged against its *own* norm. The site's
 * meters differ by more than an order of magnitude — a haul-road lighting circuit
 * and a processing plant are not comparable — so a single site-wide percentage
 * would let a small meter's collapse hide inside a large meter's noise.
 */
export async function findMeterHistory(
  companyId: number,
): Promise<MeterHistoryRow[]> {
  const { rows } = await getPool().query<MeterHistoryRow>(
    `select meter_id,
            to_char(period, 'YYYY-MM') as month,
            consumption_kwh
     from electricity_readings
     where company_id = $1
     order by meter_id, period`,
    [companyId],
  );
  return rows;
}

/** Every meter's reading for one month — the evidence that a fall is site-wide. */
export async function findMetersForMonth(
  companyId: number,
  month: string,
): Promise<MeterMonthRow[]> {
  const { rows } = await getPool().query<MeterMonthRow>(
    `select r.meter_id,
            m.description,
            r.consumption_kwh
     from electricity_readings r
     left join meters m on m.meter_id = r.meter_id and m.company_id = r.company_id
     where r.company_id = $1 and r.period = $2::date
     order by r.meter_id`,
    [companyId, `${month}-01`],
  );
  return rows;
}

/**
 * Fuel volume per month.
 *
 * Credit notes are included, because they are part of what was actually
 * delivered — netting them off here is the same arithmetic the emissions views
 * do, and excluding them would make this series disagree with the chart above it.
 */
export async function findMonthlyFuel(
  companyId: number,
): Promise<MonthlyFuelRow[]> {
  const { rows } = await getPool().query<MonthlyFuelRow>(
    `select to_char(date_trunc('month', delivery_date), 'YYYY-MM') as month,
            sum(quantity_l)                                        as litres,
            count(*)::integer                                      as delivery_count
     from fuel_deliveries
     where company_id = $1
     group by 1
     order by 1`,
    [companyId],
  );
  return rows;
}

/**
 * Incidents inside a window, with any AI finding attached.
 *
 * The window rather than the calendar month: an event that starts on the 6th and
 * runs three weeks has consequences that land in the following month, and the
 * fatigue report is exactly that kind of consequence.
 */
export async function findIncidentsBetween(
  companyId: number,
  fromDate: string,
  toDate: string,
): Promise<OutageIncidentRow[]> {
  const { rows } = await getPool().query<OutageIncidentRow>(
    `select i.id,
            to_char(i.incident_date, 'YYYY-MM-DD') as incident_date,
            i.location_raw,
            i.type_code,
            i.severity,
            i.description,
            f.category         as ai_category,
            f.is_psychosocial  as ai_is_psychosocial,
            f.evidence_quote   as ai_evidence_quote
     from incidents i
     left join ai_incident_findings f
            on f.incident_id = i.id and f.company_id = i.company_id
     where i.company_id = $1
       and i.incident_date >= $2::date
       and i.incident_date <= $3::date
     order by i.incident_date, i.id`,
    [companyId, fromDate, toDate],
  );
  return rows;
}

/** Monthly scope totals, reused from the emissions view rather than recomputed. */
export type MonthlyScopeRow = {
  month: string;
  scope1_kg_co2e: number;
  scope2_kg_co2e: number;
  total_kg_co2e: number;
  scope1_share_pct: number;
};

export async function findMonthlyScopes(
  companyId: number,
): Promise<MonthlyScopeRow[]> {
  const { rows } = await getPool().query<MonthlyScopeRow>(
    `select to_char(month, 'YYYY-MM') as month,
            scope1_kg_co2e,
            scope2_kg_co2e,
            total_kg_co2e,
            scope1_share_pct
     from v_monthly_emissions_totals
     where company_id = $1
     order by month`,
    [companyId],
  );
  return rows;
}

/** The grid factor, so the counterfactual costs electricity at the real rate. */
export async function findGridFactor(): Promise<number | null> {
  const { rows } = await getPool().query<{ kg_co2e_per_unit: number }>(
    `select kg_co2e_per_unit from emission_factors where factor_key = 'grid_electricity_qld'`,
  );
  return rows[0]?.kg_co2e_per_unit ?? null;
}
