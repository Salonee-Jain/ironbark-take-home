import { getPool } from '@ironbark/db';
import type { FastifyInstance } from 'fastify';

export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/suppliers',
    {
      schema: {
        tags: ['suppliers'],
        summary: 'Supplier list with duplicates resolved',
        description:
          'Rows the pipeline identified as duplicates keep their place and point at their primary, ' +
          'rather than being merged away — the client ledger contains both, and reconciling against ' +
          'it later needs both visible. `consolidatedSpendAud` is the true spend for the entity.',
      },
    },
    async () => {
      const { rows } = await getPool().query(
        `select
           s.id,
           s.supplier_name,
           s.name_canonical,
           s.abn_raw,
           s.abn,
           s.abn_valid,
           s.category,
           s.category_canonical,
           s.fy_spend_aud,
           s.duplicate_of_id,
           primary_row.supplier_name as duplicate_of_name,
           -- Consolidated spend on the primary row only, so summing this column
           -- over the result set gives the true total without double counting.
           case
             when s.duplicate_of_id is not null then null
             else s.fy_spend_aud + coalesce((
               select sum(d.fy_spend_aud) from suppliers d where d.duplicate_of_id = s.id
             ), 0)
           end as consolidated_spend_aud
         from suppliers s
         left join suppliers primary_row on primary_row.id = s.duplicate_of_id
         order by s.fy_spend_aud desc`,
      );

      const consolidatedTotal = rows.reduce(
        (total, row) => total + Number(row.consolidated_spend_aud ?? 0),
        0,
      );

      return {
        suppliers: rows,
        consolidatedTotalAud: consolidatedTotal,
        duplicateCount: rows.filter((row) => row.duplicate_of_id !== null).length,
      };
    },
  );
}
