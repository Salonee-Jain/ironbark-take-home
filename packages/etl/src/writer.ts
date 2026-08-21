import type { PoolClient } from 'pg';
import type { DataQualityIssue } from './issues.js';
import type { EmissionFactorRecord } from './load/emissionFactors.js';
import type {
  ElectricityReadingRecord,
  MeterRecord,
} from './load/electricity.js';
import type { FuelDeliveryRecord } from './load/fuel.js';
import type { IncidentRecord } from './load/incidents.js';
import type { SupplierRecord } from './load/suppliers.js';
import { ALL_RULES } from './rules.js';

/**
 * Writes a completed load to Postgres.
 *
 * The whole write runs in one transaction: a partially loaded database is worse
 * than an empty one, because it looks like it worked.
 */

export type LoadPayload = {
  /** Owning tenant. Every row written by this function carries it. */
  companyId: number;
  factors: EmissionFactorRecord[];
  meters: MeterRecord[];
  readings: ElectricityReadingRecord[];
  fuel: FuelDeliveryRecord[];
  incidents: IncidentRecord[];
  suppliers: SupplierRecord[];
  issues: readonly DataQualityIssue[];
};

/**
 * Tables the ETL replaces on every load, in dependency order.
 *
 * Deleted `where company_id = $1` rather than truncated, which would empty every
 * tenant's tables to reload one upload. Reference and global taxonomy tables are
 * absent on purpose. `ai_incident_findings` cascades from `incidents` and is
 * re-inserted from the committed cache afterwards.
 */
const COMPANY_OWNED_TABLES = [
  'data_quality_issues',
  'fuel_deliveries',
  'electricity_readings',
  'incidents',
  'suppliers',
  'meters',
];

/**
 * Site-area names to ids, in two tiers. The six seeded areas are global; any
 * other name came from this company's export and is created against it, so one
 * client's pit names never leak into another client's breakdowns. A
 * company-specific row wins over a global one of the same name.
 */
async function resolveSiteAreas(
  client: PoolClient,
  companyId: number,
  names: Iterable<string>,
): Promise<Map<string, number>> {
  const { rows } = await client.query<{
    id: number;
    name: string;
    company_id: number | null;
  }>(
    `select id, name, company_id from site_areas
     where company_id is null or company_id = $1
     order by company_id nulls first`,
    [companyId],
  );

  const byName = new Map<string, number>();
  for (const row of rows) byName.set(row.name, row.id);

  for (const name of names) {
    if (name === '' || byName.has(name)) continue;

    // Unknown areas are recorded rather than rejected, so the row still loads
    // and the taxonomy drift is visible as `unknown` in the UI. The
    // corresponding data-quality issue is raised by the loader.
    const { rows: inserted } = await client.query<{ id: number }>(
      `insert into site_areas (name, category, notes, company_id)
       values ($1, 'unknown', 'Seen in source data but not in the seeded taxonomy.', $2)
       returning id`,
      [name, companyId],
    );
    byName.set(name, inserted[0]!.id);
  }

  return byName;
}

export async function writeLoad(
  client: PoolClient,
  payload: LoadPayload,
): Promise<void> {
  const companyId = payload.companyId;

  // Replace-on-upload, scoped to this tenant. Deletes run child-first because
  // the cascade that `truncate` gave for free is no longer available.
  for (const table of COMPANY_OWNED_TABLES) {
    await client.query(`delete from ${table} where company_id = $1`, [companyId]);
  }

  // Site areas this company discovered in a previous upload. Dropped with the
  // rest of its data so a corrected export does not leave a phantom pit behind;
  // the six global rows are untouched by the `company_id` predicate.
  await client.query('delete from site_areas where company_id = $1', [companyId]);

  // --- emission factors -----------------------------------------------------
  // Global reference data, upserted rather than replaced. Two tenants must not
  // be able to disagree about what a litre of diesel emits, and a company whose
  // upload omits the factors file still needs the factors to exist.
  for (const factor of payload.factors) {
    await client.query(
      `insert into emission_factors (factor_key, activity, scope, unit, kg_co2e_per_unit, source)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (factor_key) do update set
         activity         = excluded.activity,
         scope            = excluded.scope,
         unit             = excluded.unit,
         kg_co2e_per_unit = excluded.kg_co2e_per_unit,
         source           = excluded.source`,
      [
        factor.factorKey,
        factor.activity,
        factor.scope,
        factor.unit,
        factor.kgCo2ePerUnit,
        factor.source,
      ],
    );
  }

  // --- meters ---------------------------------------------------------------
  for (const meter of payload.meters) {
    const periods = payload.readings
      .filter((r) => r.meterId === meter.meterId)
      .map((r) => r.period)
      .sort();

    await client.query(
      `insert into meters (company_id, meter_id, description, first_period, last_period)
       values ($1, $2, $3, $4, $5)`,
      [
        companyId,
        meter.meterId,
        meter.description,
        periods[0] ?? null,
        periods.at(-1) ?? null,
      ],
    );
  }

  // --- site areas -----------------------------------------------------------
  const siteAreaIds = await resolveSiteAreas(client, companyId, [
    ...payload.fuel.map((f) => f.siteArea),
    ...payload.incidents.map((i) => i.location),
  ]);

  // --- fuel -----------------------------------------------------------------
  for (const delivery of payload.fuel) {
    await client.query(
      `insert into fuel_deliveries (
         company_id, invoice_no, delivery_date, date_precision, fuel_type, factor_key,
         quantity_l, cost_aud, site_area_id, is_credit_note,
         original_date, original_quantity, original_unit, original_cost, source_row_number
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        companyId,
        delivery.invoiceNo,
        delivery.deliveryDate,
        delivery.datePrecision,
        delivery.fuelType,
        delivery.factorKey,
        delivery.quantityL,
        delivery.costAud,
        siteAreaIds.get(delivery.siteArea) ?? null,
        delivery.isCreditNote,
        delivery.originalDate,
        delivery.originalQuantity,
        delivery.originalUnit,
        delivery.originalCost,
        delivery.sourceRowNumber,
      ],
    );
  }

  // --- electricity ----------------------------------------------------------
  for (const reading of payload.readings) {
    await client.query(
      `insert into electricity_readings (
         company_id, meter_id, period, consumption_kwh, original_consumption, original_unit,
         unit_correction_factor, source_row_number
       ) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        companyId,
        reading.meterId,
        reading.period,
        reading.consumptionKwh,
        reading.originalConsumption,
        reading.originalUnit,
        reading.unitCorrectionFactor,
        reading.sourceRowNumber,
      ],
    );
  }

  // --- incidents ------------------------------------------------------------
  for (const incident of payload.incidents) {
    await client.query(
      `insert into incidents (
         company_id, id, source_incident_id, incident_date, site_area_id, location_raw,
         type_code, severity, severity_raw, description, source_row_number
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        companyId,
        incident.id,
        incident.sourceIncidentId,
        incident.incidentDate,
        siteAreaIds.get(incident.location) ?? null,
        incident.location,
        incident.typeCode,
        incident.severity,
        incident.severityRaw,
        incident.description,
        incident.sourceRowNumber,
      ],
    );
  }

  // --- suppliers ------------------------------------------------------------
  // Two passes: the self-referencing duplicate link can only be set once every
  // row has an id.
  const supplierIds: number[] = [];
  for (const supplier of payload.suppliers) {
    const { rows } = await client.query<{ id: number }>(
      `insert into suppliers (
         company_id, supplier_name, name_canonical, abn_raw, abn, abn_valid,
         category, category_canonical, fy_spend_aud, source_row_number
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        companyId,
        supplier.supplierName,
        supplier.nameCanonical,
        supplier.abnRaw,
        supplier.abn,
        supplier.abnValid,
        supplier.category,
        supplier.categoryCanonical,
        supplier.fySpendAud,
        supplier.sourceRowNumber,
      ],
    );
    supplierIds.push(rows[0]!.id);
  }

  for (const [index, supplier] of payload.suppliers.entries()) {
    if (supplier.duplicateOfIndex === null) continue;
    await client.query(
      'update suppliers set duplicate_of_id = $1 where id = $2',
      [supplierIds[supplier.duplicateOfIndex]!, supplierIds[index]!],
    );
  }

  // --- rule catalogue -------------------------------------------------------
  // Global, like the emission factors: the rules are ours, not a tenant's, and
  // the API serves each issue's rationale from here.
  for (const rule of ALL_RULES) {
    await client.query(
      `insert into data_quality_rules (rule_id, title, source_file, category, default_severity, default_action, rationale)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (rule_id) do update set
         title            = excluded.title,
         source_file      = excluded.source_file,
         category         = excluded.category,
         default_severity = excluded.default_severity,
         default_action   = excluded.default_action,
         rationale        = excluded.rationale`,
      [
        rule.ruleId,
        rule.title,
        rule.sourceFile,
        rule.category,
        rule.defaultSeverity,
        rule.defaultAction,
        rule.rationale,
      ],
    );
  }

  // --- issues ---------------------------------------------------------------
  for (const issue of payload.issues) {
    await client.query(
      `insert into data_quality_issues (
         company_id, rule_id, source_file, source_row_number, record_key, field,
         severity, action, description, original_value, resolved_value
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        companyId,
        issue.ruleId,
        issue.sourceFile,
        issue.sourceRowNumber,
        issue.recordKey,
        issue.field,
        issue.severity,
        issue.action,
        issue.description,
        issue.originalValue,
        issue.resolvedValue,
      ],
    );
  }
}
