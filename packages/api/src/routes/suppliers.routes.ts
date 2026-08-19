import type { FastifyInstance } from 'fastify';
import { companyIdOf } from '../middlewares/authenticate.js';
import { errorResponse } from '../schemas/common.schema.js';
import * as service from '../services/suppliers.service.js';

export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/suppliers',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['suppliers'],
        summary: 'Supplier list with duplicates resolved',
        description:
          'Duplicate rows keep their place and point at their primary rather than being merged away — ' +
          'the client ledger contains both, and reconciling against it later needs both visible. ' +
          'consolidatedSpendAud is populated on primary rows only, so summing it gives the true total.',
        response: { 401: errorResponse },
      },
    },
    (request) => service.listSuppliers(companyIdOf(request)),
  );
}
