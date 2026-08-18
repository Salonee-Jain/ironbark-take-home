import type { FastifyInstance } from 'fastify';
import { dataQualityRoutes } from './dataQuality.routes.js';
import { emissionsRoutes } from './emissions.routes.js';
import { healthRoutes } from './health.routes.js';
import { incidentRoutes } from './incidents.routes.js';
import { supplierRoutes } from './suppliers.routes.js';

/** One place to see every route group the server exposes. */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(emissionsRoutes);
  await app.register(incidentRoutes);
  await app.register(dataQualityRoutes);
  await app.register(supplierRoutes);
}
