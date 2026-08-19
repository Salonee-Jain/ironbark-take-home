import type { CsvFile } from '../csv.js';

/**
 * Emission factors.
 *
 * The brief says this file is clean and to use it as given, so there are no
 * rules here — only the mapping from the file's prose activity names to stable
 * keys. Joining fact tables on a string like
 * 'Diesel combustion (stationary & transport)' works right up until someone
 * edits the wording.
 */

export const FACTOR_KEY_BY_ACTIVITY: Record<string, string> = {
  'Diesel combustion (stationary & transport)': 'diesel',
  'Petrol (ULP) combustion': 'petrol_ulp',
  'Grid electricity - Queensland': 'grid_electricity_qld',
};

/** Fuel Type as written in fuel_deliveries.csv -> factor key. */
export const FACTOR_KEY_BY_FUEL_TYPE: Record<string, string> = {
  Diesel: 'diesel',
  'Petrol (ULP)': 'petrol_ulp',
};

export const GRID_ELECTRICITY_FACTOR_KEY = 'grid_electricity_qld';

export type EmissionFactorRecord = {
  factorKey: string;
  activity: string;
  scope: number;
  unit: string;
  kgCo2ePerUnit: number;
  source: string;
};

export function loadEmissionFactors(file: CsvFile): EmissionFactorRecord[] {

  return file.rows.map((row) => {
    const activity = row.value('activity').trim();
    const factorKey = FACTOR_KEY_BY_ACTIVITY[activity];

    if (!factorKey) {
      // Not a data-quality issue — a code change. A new factor in this file
      // needs a deliberate decision about what it applies to.
      throw new Error(
        `Unmapped emission factor activity: "${activity}" (line ${row.lineNumber}). ` +
          'Add it to FACTOR_KEY_BY_ACTIVITY and decide which activity data it applies to.',
      );
    }

    return {
      factorKey,
      activity,
      scope: Number(row.value('scope')),
      unit: row.value('unit').trim(),
      kgCo2ePerUnit: Number(row.value('kg_co2e_per_unit')),
      source: row.value('source').trim(),
    };
  });
}
