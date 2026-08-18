import * as repository from '../repositories/suppliers.repository.js';
import { camelCaseRows } from '../utils/case.js';

export async function listSuppliers() {
  const rows = await repository.findSuppliers();

  // Only primary rows carry a consolidated figure, so this sums each entity
  // exactly once even though duplicates remain in the list.
  const consolidatedTotalAud = rows.reduce(
    (total, row) => total + (row.consolidated_spend_aud ?? 0),
    0,
  );

  const rawTotalAud = rows.reduce((total, row) => total + row.fy_spend_aud, 0);

  return {
    suppliers: camelCaseRows(rows),
    consolidatedTotalAud,
    // Identical here, and that is the point: the duplicates were linked rather
    // than dropped, so no spend went missing in the process.
    rawTotalAud,
    duplicateCount: rows.filter((row) => row.duplicate_of_id !== null).length,
    invalidAbnCount: rows.filter((row) => row.abn === null || row.abn.length !== 11)
      .length,
  };
}
