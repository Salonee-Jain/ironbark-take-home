import { getPool } from '@ironbark/db';

/**
 * Health checks the dependency, not just the process. A server that answers
 * while its database is unreachable is worse than a red health check, because
 * nothing downstream notices.
 */
export async function countLoadedDeliveries(): Promise<number> {
  const { rows } = await getPool().query<{ loaded: number }>(
    'select count(*)::int as loaded from fuel_deliveries',
  );
  return rows[0]?.loaded ?? 0;
}
