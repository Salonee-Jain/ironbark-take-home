import { getPool } from '@ironbark/db';

/**
 * Health checks the dependency, not just the process. A server that answers
 * while its database is unreachable is worse than a red health check, because
 * nothing downstream notices.
 *
 * Deliberately not scoped to a company: `/health` is the one endpoint that
 * answers without a session, so there is no company to scope it to. It reports
 * how many tenants exist and how many fuel rows are loaded across all of them —
 * enough to tell "database up, nothing loaded" from "database up and populated"
 * without disclosing anything about a particular company.
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
