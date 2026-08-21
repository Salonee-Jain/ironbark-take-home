import { getPool } from '@ironbark/db';

/**
 * Health checks the dependency, not just the process: a server that answers
 * while its database is unreachable is worse than a red check.
 *
 * Not scoped to a company, because /health is the one endpoint without a
 * session. It reports how many tenants exist and how many fuel rows are loaded
 * across all of them, which distinguishes "up but empty" from "up and
 * populated" without disclosing anything about a company.
 */
export async function countLoaded(): Promise<{
  companies: number;
  fuelDeliveries: number;
}> {
  const { rows } = await getPool().query<{
    companies: number;
    fuel_deliveries: number;
  }>(
    `select (select count(*)::int from companies)       as companies,
            (select count(*)::int from fuel_deliveries) as fuel_deliveries`,
  );
  return {
    companies: rows[0]?.companies ?? 0,
    fuelDeliveries: rows[0]?.fuel_deliveries ?? 0,
  };
}
