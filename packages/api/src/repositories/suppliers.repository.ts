import { getPool } from '@ironbark/db';

export type SupplierRow = {
  id: number;
  supplier_name: string;
  name_canonical: string;
  abn_raw: string | null;
  abn: string | null;
  abn_valid: boolean;
  category: string | null;
  category_canonical: string | null;
  fy_spend_aud: number;
  duplicate_of_id: number | null;
  duplicate_of_name: string | null;
  consolidated_spend_aud: number | null;
};

export async function findSuppliers(
  companyId: number,
): Promise<SupplierRow[]> {
  const { rows } = await getPool().query<SupplierRow>(
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
       -- Populated on primary rows only, so summing this column over the whole
       -- result set gives the true total without double counting.
       case
         when s.duplicate_of_id is not null then null
         else s.fy_spend_aud + coalesce((
           select sum(d.fy_spend_aud) from suppliers d
           where d.duplicate_of_id = s.id and d.company_id = s.company_id
         ), 0)
       end as consolidated_spend_aud
     from suppliers s
     left join suppliers primary_row on primary_row.id = s.duplicate_of_id
     where s.company_id = $1
     order by s.fy_spend_aud desc`,
    [companyId],
  );
  return rows;
}
