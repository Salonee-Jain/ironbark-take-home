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
  factors: EmissionFactorRecord[];
  meters: MeterRecord[];
  readings: ElectricityReadingRecord[];
  fuel: FuelDeliveryRecord[];
  incidents: IncidentRecord[];
  suppliers: SupplierRecord[];
  issues: readonly DataQualityIssue[];
};

/**
 * Tables the ETL owns. Reference tables seeded by migration 0001 are absent on
 * purpose: they are schema, not load output.
 *
 * `cascade` reaches ai_incident_findings through incidents. That is intended —
 * findings cite incident IDs, so they cannot outlive a reload of the register.
 * They are re-inserted from the committed cache by `npm run ai:classify`.
 */
const OWNED_TABLES = [
  'data_quality_issues',
  'data_quality_rules',
  'fuel_deliveries',
  'electricity_readings',
  'incidents',
  'suppliers',
  'meters',
  'emission_factors',
];

async function resolveSiteAreas(
  client: PoolClient,
  names: Iterable<string>,
): Promise<Map<string, number>> {
  const { rows } = await client.query<{ id: number; name: string }>(
    'select id, name from site_areas',
  );
  const byName = new Map(rows.map((r) => [r.name, r.id]));

  for (const name of names) {
    if (name === '' || byName.has(name)) continue;

    // Unknown areas are recorded rather than rejected, so the row still loads
    // and the taxonomy drift is visible as `unknown` in the UI. The
    // corresponding data-quality issue is raised by the loader.
    const { rows: inserted } = await client.query<{ id: number }>(
      `insert into site_areas (name, category, notes)
       values ($1, 'unknown', 'Seen in source data but not in the seeded taxonomy.')
       returning id`,
      [name],
    );
    byName.set(name, inserted[0]!.id);
  }

  return byName;
}

export async function writeLoad(
  client: PoolClient,
  payload: LoadPayload,
): Promise<void> {
  await client.query(
    `truncate table ${OWNED_TABLES.join(', ')} restart identity cascade`,
  );

  // --- emission factors -----------------------------------------------------
  for (const factor of payload.factors) {
    await client.query(
      `insert into emission_factors (factor_key, activity, scope, unit, kg_co2e_per_unit, source)
       values ($1, $2, $3, $4, $5, $6)`,
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
      `insert into meters (meter_id, description, first_period, last_period)
       values ($1, $2, $3, $4)`,
      [meter.meterId, meter.description, periods[0] ?? null, periods.at(-1) ?? null],
    );
  }

  // --- site areas -----------------------------------------------------------
  const siteAreaIds = await resolveSiteAreas(client, [
    ...payload.fuel.map((f) => f.siteArea),
    ...payload.incidents.map((i) => i.location),
  ]);

  // --- fuel -----------------------------------------------------------------
  for (const delivery of payload.fuel) {
    await client.query(
      `insert into fuel_deliveries (
         invoice_no, delivery_date, date_precision, fuel_type, factor_key,
         quantity_l, cost_aud, site_area_id, is_credit_note,
         original_date, original_quantity, original_unit, original_cost, source_row_number
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
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
         meter_id, period, consumption_kwh, original_consumption, original_unit,
         unit_correction_factor, source_row_number
       ) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
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
         id, source_incident_id, incident_date, site_area_id, location_raw,
         type_code, severity, severity_raw, description, source_row_number
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
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
         supplier_name, name_canonical, abn_raw, abn, abn_valid,
         category, category_canonical, fy_spend_aud, source_row_number
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
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
  for (const rule of ALL_RULES) {
    await client.query(
      `insert into data_quality_rules (rule_id, title, source_file, category, default_severity, default_action, rationale)
       values ($1,$2,$3,$4,$5,$6,$7)`,
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
         rule_id, source_file, source_row_number, record_key, field,
         severity, action, description, original_value, resolved_value
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
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
