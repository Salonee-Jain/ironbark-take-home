import { ServiceUnavailableError } from '../errors.js';
import { countLoadedDeliveries } from '../repositories/health.repository.js';

export async function getHealth() {
  try {
    const loaded = await countLoadedDeliveries();
    return {
      status: 'ok' as const,
      database: 'connected' as const,
      fuelDeliveriesLoaded: loaded,
      // An empty but reachable database is a distinct state from a broken one,
      // and the fix is different. Say which.
      dataLoaded: loaded > 0,
      ...(loaded === 0 ? { hint: 'Database is empty. Run: npm run etl' } : {}),
    };
  } catch (error) {
    throw new ServiceUnavailableError(
      error instanceof Error ? error.message : String(error),
      'Is Postgres running? npm run db:up && npm run db:migrate && npm run etl',
    );
  }
}
