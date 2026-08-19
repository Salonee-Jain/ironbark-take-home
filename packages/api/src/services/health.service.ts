import { ServiceUnavailableError } from '../errors.js';
import { countLoaded } from '../repositories/health.repository.js';

export async function getHealth() {
  try {
    const { companies, fuelDeliveries } = await countLoaded();
    return {
      status: 'ok' as const,
      database: 'connected' as const,
      companies,
      fuelDeliveriesLoaded: fuelDeliveries,
      // An empty but reachable database is a distinct state from a broken one,
      // and the fix is different. Say which.
      dataLoaded: fuelDeliveries > 0,
      ...(fuelDeliveries === 0
        ? { hint: 'Database is empty. Run: npm run etl' }
        : {}),
    };
  } catch (error) {
    throw new ServiceUnavailableError(
      error instanceof Error ? error.message : String(error),
      'Is Postgres running? npm run db:up && npm run db:migrate && npm run etl',
    );
  }
}
