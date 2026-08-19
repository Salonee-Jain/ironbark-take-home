import type { PoolClient } from 'pg';
import { withClient } from '@ironbark/db';
import { loadAiFindings, type AiLoadResult } from './ai/load.js';
import { parseCsv } from './csv.js';
import { IssueCollector, type DataQualityIssue } from './issues.js';
import { loadElectricityReadings } from './load/electricity.js';
import { loadEmissionFactors } from './load/emissionFactors.js';
import { loadFuelDeliveries } from './load/fuel.js';
import { loadIncidents } from './load/incidents.js';
import { loadSuppliers } from './load/suppliers.js';
import { writeLoad } from './writer.js';

/**
 * One ingest, for one company, from CSV text.
 *
 * This is the seam that lets `npm run etl` and `POST /api/uploads` be the same
 * pipeline rather than two implementations that drift. The CLI reads the files
 * from `data/raw/`; the API takes them off a multipart request. Neither knows
 * anything the other does not, so a data-quality rule cannot be enforced on the
 * command line and quietly skipped on upload.
 *
 * Everything below the parse is deliberately identical to what the CLI always
 * did: one transaction, replace the company's data, record every finding.
 */

export const INGEST_FILES = [
  'emission_factors.csv',
  'fuel_deliveries.csv',
  'electricity_meter_readings.csv',
  'incident_register.csv',
  'suppliers.csv',
] as const;

export type IngestFileName = (typeof INGEST_FILES)[number];

/** CSV text keyed by the canonical filename it plays the role of. */
export type IngestInput = Partial<Record<IngestFileName, string>>;

export type IngestResult = {
  companyId: number;
  rowCounts: Record<string, number>;
  issues: readonly DataQualityIssue[];
  issueCount: number;
  errorCount: number;
  issuesByRule: [string, number][];
  ai: AiLoadResult;
};

export class MissingFileError extends Error {
  constructor(readonly missing: IngestFileName[]) {
    super(
      `Missing required file(s): ${missing.join(', ')}. ` +
        'An upload replaces the whole dataset, so a partial one would silently delete the rest.',
    );
    this.name = 'MissingFileError';
  }
}

/**
 * Which files an upload must carry.
 *
 * All five, and this is the direct consequence of replace-on-upload: a load
 * that accepted only `incident_register.csv` would delete the company's fuel
 * and electricity along with the old incidents, and report success. The
 * alternative — merging per file — is a real feature, but it is a different one,
 * and pretending to offer it here would lose data.
 */
function assertComplete(input: IngestInput): asserts input is Required<IngestInput> {
  const missing = INGEST_FILES.filter((name) => {
    const text = input[name];
    return text === undefined || text.trim() === '';
  });
  if (missing.length > 0) throw new MissingFileError(missing);
}

/**
 * Parse, clean and write. Runs inside a caller-supplied client so the API can
 * wrap the load and its audit row in a single transaction.
 */
export async function ingestWithClient(
  client: PoolClient,
  companyId: number,
  input: IngestInput,
): Promise<IngestResult> {
  assertComplete(input);

  const issues = new IssueCollector();

  const factors = loadEmissionFactors(
    parseCsv(input['emission_factors.csv'], 'emission_factors.csv'),
  );
  const fuel = loadFuelDeliveries(
    parseCsv(input['fuel_deliveries.csv'], 'fuel_deliveries.csv'),
    issues,
  );
  const { meters, readings } = loadElectricityReadings(
    parseCsv(
      input['electricity_meter_readings.csv'],
      'electricity_meter_readings.csv',
    ),
    issues,
  );
  const incidents = loadIncidents(
    parseCsv(input['incident_register.csv'], 'incident_register.csv'),
    issues,
  );
  const suppliers = loadSuppliers(
    parseCsv(input['suppliers.csv'], 'suppliers.csv'),
    issues,
  );

  await writeLoad(client, {
    companyId,
    factors,
    meters,
    readings,
    fuel,
    incidents,
    suppliers,
    issues: issues.all(),
  });

  // Inside the same transaction as the load: the findings cite incident IDs,
  // and a database holding one without the other is not a state worth
  // committing.
  const ai = await loadAiFindings(client, companyId);

  const all = issues.all();

  return {
    companyId,
    rowCounts: {
      emission_factors: factors.length,
      meters: meters.length,
      electricity_readings: readings.length,
      fuel_deliveries: fuel.length,
      incidents: incidents.length,
      suppliers: suppliers.length,
      data_quality_issues: all.length,
    },
    issues: all,
    issueCount: all.length,
    errorCount: all.filter((issue) => issue.severity === 'error').length,
    issuesByRule: [...issues.countByRule().entries()].sort((a, b) => b[1] - a[1]),
    ai,
  };
}

/** Ingest on a pool client of its own, in one transaction. */
export async function ingest(
  companyId: number,
  input: IngestInput,
): Promise<IngestResult> {
  return withClient(async (client) => {
    await client.query('begin');
    try {
      const result = await ingestWithClient(client, companyId, input);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
}
