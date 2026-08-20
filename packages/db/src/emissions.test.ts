import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool } from './index.js';

/**
 * The emissions golden test.
 *
 * The calculation lives in SQL views so the numbers on screen and the numbers
 * in a psql session cannot drift apart. The cost of that choice is that the
 * arithmetic is not covered by any unit test — which is why this file exists,
 * and why the expected values below are written out longhand from the source
 * rows rather than read back out of another query. A test that asked the
 * database to confirm its own arithmetic would pass no matter what the views
 * said.
 *
 * Requires a loaded database:
 *
 *   npm run db:up && npm run db:migrate && npm run etl
 *
 * Skips rather than fails when there is none, so `npm test` still works on a
 * machine with no Docker. CI runs it with a Postgres service container, so the
 * skip cannot quietly become permanent.
 */

const COMPANY_SLUG = 'ironbark-ridge';

/** Factors as seeded in `emission_factors.csv`, restated so the test does not
 *  inherit an error from the table it is checking. */
const DIESEL = 2.7;
const PETROL = 2.31;
const GRID = 0.71;

async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { rows } = await getPool().query<T>(sql, params);
  return rows;
}

const num = (value: unknown): number => Number(value);

/**
 * Detected at module scope, not in `beforeAll`.
 *
 * `describe` bodies run at collection time, before any hook has fired, so a
 * flag set in `beforeAll` is still false when `it` vs `it.skip` is chosen — and
 * the whole file skips against a perfectly good database. Top-level await
 * resolves before collection.
 */
async function loadedCompanyId(): Promise<number | null> {
  try {
    const rows = await query<{ id: number }>(
      'select id from companies where slug = $1',
      [COMPANY_SLUG],
    );
    const id = rows[0]?.id;
    if (id === undefined) return null;

    const [row] = await query<{ count: string }>(
      'select count(*)::text as count from fuel_deliveries where company_id = $1',
      [id],
    );
    return Number(row?.count ?? 0) > 0 ? id : null;
  } catch {
    return null;
  }
}

const companyId = await loadedCompanyId();

if (companyId === null) {
  // A suite that skips is a suite that stops protecting anything, and the
  // skip is invisible in a green run. CI sets REQUIRE_DB so that the
  // convenience of skipping locally cannot quietly become permanent.
  if (process.env['REQUIRE_DB'] === '1') {
    throw new Error(
      'REQUIRE_DB=1 but no loaded database was found. Expected the demo company ' +
        `"${COMPANY_SLUG}" with fuel deliveries — run the migrations and the ETL first.`,
    );
  }
  console.warn(
    '[emissions.test] no loaded database — skipping. Run: npm run db:up && npm run db:migrate && npm run etl',
  );
}

const withDb = () => (companyId === null ? it.skip : it);

afterAll(async () => {
  await closePool();
});

describe('v_monthly_emissions_totals — August 2025, computed by hand', () => {
  /**
   * August 2025 is the month worth doing longhand: it contains the credit note,
   * so it proves the reversal nets off instead of being dropped or counted
   * twice.
   *
   * Ten diesel deliveries, one of them the credit:
   *
   *   36,216 + 74,877 + 48,397 + 45,860 + 49,276
   *   + 65,232 + 51,407 + 48,580 + 40,035        =  459,880 L
   *   INV-41777 credit                            =  -12,500 L
   *                                               ------------
   *                                                  447,380 L
   *
   *   Scope 1  = 447,380 x 2.70  =  1,207,926.00
   *            +   4,874 x 2.31  =     11,258.94   (one petrol delivery)
   *                              =  1,219,184.94 kg CO2e
   *
   *   Scope 2  = 1,987,043.70 kWh x 0.71
   *                              =  1,410,801.03 kg CO2e
   *
   *   Total                      =  2,629,985.97 kg CO2e
   */
  const EXPECTED_DIESEL_LITRES = 447_380;
  const EXPECTED_PETROL_LITRES = 4_874;
  const EXPECTED_KWH = 1_987_043.7;

  withDb()('reports the hand-computed Scope 1', async () => {
    const [row] = await query(
      `select scope1_kg_co2e from v_monthly_emissions_totals
       where company_id = $1 and month = '2025-08-01'`,
      [companyId],
    );
    expect(num(row?.['scope1_kg_co2e'])).toBeCloseTo(
      EXPECTED_DIESEL_LITRES * DIESEL + EXPECTED_PETROL_LITRES * PETROL,
      2,
    );
    expect(num(row?.['scope1_kg_co2e'])).toBe(1_219_184.94);
  });

  withDb()('reports the hand-computed Scope 2', async () => {
    const [row] = await query(
      `select scope2_kg_co2e from v_monthly_emissions_totals
       where company_id = $1 and month = '2025-08-01'`,
      [companyId],
    );
    expect(num(row?.['scope2_kg_co2e'])).toBeCloseTo(EXPECTED_KWH * GRID, 2);
    expect(num(row?.['scope2_kg_co2e'])).toBe(1_410_801.03);
  });

  withDb()('totals the two scopes', async () => {
    const [row] = await query(
      `select total_kg_co2e, contributing_records from v_monthly_emissions_totals
       where company_id = $1 and month = '2025-08-01'`,
      [companyId],
    );
    expect(num(row?.['total_kg_co2e'])).toBe(2_629_985.97);
    // 11 fuel deliveries + 6 meter readings.
    expect(num(row?.['contributing_records'])).toBe(17);
  });

  withDb()('nets the credit note off rather than dropping it', async () => {
    // The assertion that distinguishes "handled" from "ignored": drop the
    // credit and diesel would read 459,880 L; flip its sign and 472,380 L.
    const [row] = await query(
      `select sum(quantity_l) as litres from fuel_deliveries
       where company_id = $1 and fuel_type = 'Diesel'
         and delivery_date >= '2025-08-01' and delivery_date < '2025-09-01'`,
      [companyId],
    );
    expect(num(row?.['litres'])).toBe(EXPECTED_DIESEL_LITRES);
    expect(num(row?.['litres'])).not.toBe(459_880);
    expect(num(row?.['litres'])).not.toBe(472_380);
  });
});

describe('the MTR-07 unit correction reaches the emissions figure', () => {
  withDb()('corrects nine readings and keeps the original', async () => {
    const rows = await query(
      `select period::text, consumption_kwh, original_consumption, unit_correction_factor
       from electricity_readings
       where company_id = $1 and meter_id = 'MTR-07' and unit_correction_factor <> 1
       order by period`,
      [companyId],
    );
    expect(rows).toHaveLength(9);
    expect(rows[0]?.['period']).toBe('2025-10-01');

    for (const row of rows) {
      expect(num(row['consumption_kwh'])).toBeCloseTo(
        num(row['original_consumption']) * num(row['unit_correction_factor']),
        2,
      );
    }
  });

  withDb()('materially raises Scope 2 for the affected months', async () => {
    // October 2025: 277 kWh as recorded against 277,000 corrected. Left alone,
    // Scope 2 would be understated by ~196 tonnes in that month alone — the
    // single largest error in the dataset, and one that reduces the reported
    // figure, which is the direction nobody questions.
    const [row] = await query(
      `select scope2_kg_co2e from v_monthly_emissions_totals
       where company_id = $1 and month = '2025-10-01'`,
      [companyId],
    );

    const [raw] = await query(
      `select sum(original_consumption) as kwh from electricity_readings
       where company_id = $1 and period = '2025-10-01'`,
      [companyId],
    );

    const uncorrected = num(raw?.['kwh']) * GRID;
    expect(num(row?.['scope2_kg_co2e'])).toBeGreaterThan(uncorrected + 190_000);
  });

  withDb()('leaves the pre-correction months untouched', async () => {
    const rows = await query(
      `select count(*)::text as count from electricity_readings
       where company_id = $1 and meter_id = 'MTR-07' and period < '2025-10-01'
         and unit_correction_factor <> 1`,
      [companyId],
    );
    expect(Number(rows[0]?.['count'])).toBe(0);
  });
});

describe('month-precision fuel lands in its own month', () => {
  withDb()('anchors every month-precision delivery to the first', async () => {
    const rows = await query(
      `select count(*)::text as count from fuel_deliveries
       where company_id = $1 and date_precision = 'month'
         and extract(day from delivery_date) <> 1`,
      [companyId],
    );
    expect(Number(rows[0]?.['count'])).toBe(0);
  });

  withDb()('still counts those deliveries in the monthly total', async () => {
    // Precision is recorded so day-level analysis can exclude them; it must not
    // quietly exclude them from the monthly figure as well.
    const [row] = await query(
      `select count(*)::text as count from fuel_deliveries
       where company_id = $1 and date_precision = 'month'`,
      [companyId],
    );
    expect(Number(row?.['count'])).toBe(26);
  });
});

describe('the November 2025 fuel gap is visible, not interpolated', () => {
  withDb()('reports zero Scope 1 for the month with no invoices', async () => {
    // An interpolated month would look normal here, which is exactly the
    // failure: understated Scope 1 that nothing draws attention to.
    const [row] = await query(
      `select scope1_kg_co2e, scope2_kg_co2e from v_monthly_emissions_totals
       where company_id = $1 and month = '2025-11-01'`,
      [companyId],
    );
    expect(num(row?.['scope1_kg_co2e'])).toBe(0);
    // The site was plainly operating — a full month of electricity is recorded.
    expect(num(row?.['scope2_kg_co2e'])).toBeGreaterThan(1_000_000);
  });
});

describe('March 2026 — the outage month', () => {
  withDb()('shows Scope 2 collapsing while Scope 1 rises', async () => {
    const [march] = await query(
      `select scope1_kg_co2e, scope2_kg_co2e, total_kg_co2e, scope1_share_pct
       from v_monthly_emissions_totals where company_id = $1 and month = '2026-03-01'`,
      [companyId],
    );
    const [february] = await query(
      `select scope1_kg_co2e, scope2_kg_co2e
       from v_monthly_emissions_totals where company_id = $1 and month = '2026-02-01'`,
      [companyId],
    );

    expect(num(march?.['scope2_kg_co2e'])).toBeLessThan(
      num(february?.['scope2_kg_co2e']) * 0.4,
    );
    expect(num(march?.['scope1_kg_co2e'])).toBeGreaterThan(
      num(february?.['scope1_kg_co2e']),
    );

    // The share is the number that makes the story legible: stable near 47%
    // all period, then 79% for this one month.
    expect(num(march?.['scope1_share_pct'])).toBeGreaterThan(75);
  });

  withDb()('is not the lowest-emitting month, despite the headline drop', async () => {
    // "Our emissions fell in March" is the wrong reading, and this is the
    // assertion that pins it: total falls only slightly, because the dirtier
    // fuel replaced the cleaner grid.
    const rows = await query(
      `select month::text, total_kg_co2e from v_monthly_emissions_totals
       where company_id = $1 and month >= '2025-07-01'
       order by total_kg_co2e asc limit 1`,
      [companyId],
    );
    // November 2025 — the month with no fuel paperwork — is lower.
    expect(rows[0]?.['month']).toBe('2025-11-01');
  });
});

describe('cross-checks over the whole period', () => {
  withDb()('reports 18 continuous months', async () => {
    const rows = await query(
      `select month::text from v_monthly_emissions_totals
       where company_id = $1 order by month`,
      [companyId],
    );
    expect(rows).toHaveLength(18);
    expect(rows[0]?.['month']).toBe('2025-01-01');
    expect(rows[17]?.['month']).toBe('2026-06-01');
  });

  withDb()('scope totals reconcile with the per-activity view', async () => {
    // The roll-up and its source must agree; a `group by` that lost a row would
    // show up here and nowhere else.
    const rows = await query(
      `select t.month::text,
              t.total_kg_co2e as rollup,
              (select round(sum(m.kg_co2e), 2) from v_monthly_emissions m
               where m.company_id = t.company_id and m.month = t.month) as detail
       from v_monthly_emissions_totals t
       where t.company_id = $1 order by t.month`,
      [companyId],
    );

    for (const row of rows) {
      expect(num(row['rollup']), String(row['month'])).toBeCloseTo(
        num(row['detail']),
        2,
      );
    }
  });

  withDb()('every activity uses the factor its scope implies', async () => {
    const rows = await query(
      `select factor_key, scope, kg_co2e_per_unit from emission_factors order by factor_key`,
    );
    // Numbers, not strings: pool.ts overrides pg's NUMERIC parser, and a
    // regression there would have every chart plotting concatenated text.
    expect(rows).toEqual([
      { factor_key: 'diesel', scope: 1, kg_co2e_per_unit: DIESEL },
      { factor_key: 'grid_electricity_qld', scope: 2, kg_co2e_per_unit: GRID },
      { factor_key: 'petrol_ulp', scope: 1, kg_co2e_per_unit: PETROL },
    ]);
  });

  withDb()('no month reports a negative footprint', async () => {
    const rows = await query(
      `select month::text from v_monthly_emissions_totals
       where company_id = $1 and (scope1_kg_co2e < 0 or scope2_kg_co2e < 0)`,
      [companyId],
    );
    expect(rows).toEqual([]);
  });
});
