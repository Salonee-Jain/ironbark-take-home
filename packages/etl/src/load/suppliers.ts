import { readCsv } from '../csv.js';
import type { IssueCollector } from '../issues.js';
import { canonicaliseEntityName, compareEntities, normaliseAbn } from '../normalise/index.js';

export type SupplierRecord = {
  supplierName: string;
  nameCanonical: string;
  abnRaw: string | null;
  abn: string | null;
  abnValid: boolean;
  category: string | null;
  categoryCanonical: string | null;
  fySpendAud: number;
  /** Index into this same array, resolved to a database id by the writer. */
  duplicateOfIndex: number | null;
  sourceRowNumber: number;
};

export function loadSuppliers(
  path: string,
  issues: IssueCollector,
): SupplierRecord[] {
  const file = readCsv(path);

  const records: SupplierRecord[] = file.rows.map((row) => {
    const supplierName = row.value('supplier_name').trim();
    const abnRaw = row.value('abn').trim();
    const category = row.value('category').trim();
    const abn = normaliseAbn(abnRaw);

    return {
      supplierName,
      nameCanonical: canonicaliseEntityName(supplierName),
      abnRaw: abnRaw === '' ? null : abnRaw,
      abn: abn.digits,
      abnValid: abn.checksumValid,
      category: category === '' ? null : category,
      categoryCanonical: category === '' ? null : category,
      fySpendAud: Number(row.value('fy_spend_aud')),
      duplicateOfIndex: null,
      sourceRowNumber: row.lineNumber,
    };
  });

  // --- ABN structure --------------------------------------------------------
  let wellFormed = 0;
  let checksumFailures = 0;

  for (const record of records) {
    const abn = normaliseAbn(record.abnRaw);
    // Counted against well-formed ABNs, not merely present ones: a 7-digit
    // value has no checksum to fail, and including it in the denominator would
    // stop the "every ABN fails" observation from ever being true.
    if (abn.wellFormed) wellFormed++;
    if (abn.wellFormed && !abn.checksumValid) checksumFailures++;

    if (!abn.wellFormed) {
      issues.add({
        ruleId: 'SUP-ABN-FORM-01',
        sourceRowNumber: record.sourceRowNumber,
        recordKey: record.supplierName,
        field: 'abn',
        description: abn.present
          ? `ABN has ${abn.digits?.length} digits; an ABN has 11. Loaded as recorded and flagged — an entity cannot be reliably identified for procurement or tax on this value.`
          : 'No ABN recorded. Loaded as null rather than defaulted, so the gap stays visible.',
        originalValue: record.abnRaw ?? '(blank)',
      });
    }
  }

  // --- ABN checksum, once for the file --------------------------------------
  if (wellFormed > 0 && checksumFailures === wellFormed) {
    issues.add({
      ruleId: 'SUP-ABN-CHECKSUM-01',
      field: 'abn',
      description:
        `All ${wellFormed} correctly formed ABNs in this file fail the ATO modulus-89 checksum. ` +
        'A rule that fails for every row is evidence about the source, not about the client: these are almost ' +
        'certainly synthetic or masked values. Reported once rather than per row so it does not bury the genuinely ' +
        'malformed ABN above. No supplier is marked invalid on this basis alone.',
      originalValue: `${checksumFailures}/${wellFormed} fail checksum`,
    });
  }

  // --- duplicate entities ---------------------------------------------------
  // Every pair is compared. The set is 15 rows; readability beats an index.
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i]!;
      const b = records[j]!;
      if (b.duplicateOfIndex !== null) continue;

      const match = compareEntities(
        { name: a.supplierName, abn: a.abn },
        { name: b.supplierName, abn: b.abn },
      );
      if (!match.isDuplicate) continue;

      // Primary is the row with a well-formed ABN, then the larger spend. That
      // picks the more complete record in both cases here, and picks the
      // correctly-spelled name for the pair that shares an ABN.
      const aIsPrimary =
        (a.abn !== null && b.abn === null) ||
        (a.abn === null) === (b.abn === null) &&
          a.fySpendAud >= b.fySpendAud;

      const primary = aIsPrimary ? a : b;
      const duplicate = aIsPrimary ? b : a;
      const duplicateIndex = aIsPrimary ? j : i;
      const primaryIndex = aIsPrimary ? i : j;

      records[duplicateIndex]!.duplicateOfIndex = primaryIndex;

      const combined = a.fySpendAud + b.fySpendAud;
      issues.add({
        ruleId: 'SUP-DUP-01',
        sourceRowNumber: duplicate.sourceRowNumber,
        recordKey: duplicate.supplierName,
        field: 'supplier_name',
        description:
          `Same entity as "${primary.supplierName}" (matched on ${match.reason.replace(/-/g, ' ')}` +
          `${match.reason === 'near-identical-name' ? `, edit distance ${match.editDistance}` : ''}). ` +
          `Linked rather than merged away, so both remain reconcilable against the client's ledger. ` +
          `Combined spend $${combined.toLocaleString()} against $${primary.fySpendAud.toLocaleString()} for the primary row alone.`,
        originalValue: duplicate.supplierName,
        resolvedValue: `duplicate of ${primary.supplierName}`,
      });

      // --- category alignment ------------------------------------------------
      if (
        duplicate.category !== null &&
        primary.category !== null &&
        duplicate.category !== primary.category
      ) {
        records[duplicateIndex]!.categoryCanonical = primary.category;
        issues.add({
          ruleId: 'SUP-CATEGORY-01',
          sourceRowNumber: duplicate.sourceRowNumber,
          recordKey: duplicate.supplierName,
          field: 'category',
          description: `Category "${duplicate.category}" aligned to "${primary.category}" from the primary record of the pair, so spend groups correctly.`,
          originalValue: duplicate.category,
          resolvedValue: primary.category,
        });
      }
    }
  }

  return records;
}
