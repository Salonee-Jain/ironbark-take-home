/**
 * Domain vocabulary shared across the ETL, API and web packages.
 *
 * These types exist in one place because the data-quality contract is the spine of
 * this project: the ETL emits issues, the API serves them, the UI renders them, and
 * all three have to agree on what "flagged" means.
 */

/**
 * What the pipeline did about a problem it found in the source data.
 *
 * The assignment's instruction was "do not silently discard problems", so every
 * detected issue carries one of these, and `rejected` still leaves a record behind.
 */
export type DataQualityAction =
  /** The value was corrected and the original retained alongside it. */
  | 'fixed'
  /** Loaded as-is, surfaced for a human to confirm. We do not guess. */
  | 'flagged'
  /** Excluded from analytics, but recorded here with the reason. */
  | 'rejected';

/** How much a data-quality issue threatens the numbers downstream. */
export type DataQualitySeverity =
  /** Materially wrong figures if unaddressed. */
  | 'error'
  /** Suspicious, needs client confirmation, numbers may shift. */
  | 'warning'
  /** Cosmetic or informational; no impact on reported figures. */
  | 'info';

/** Greenhouse gas protocol scopes covered by this dataset. */
export type EmissionScope = 1 | 2;

/**
 * Normalised incident severity.
 *
 * The source register mixes a `Low`/`Medium` scale with a `1`/`2`/`3` scale; both are
 * mapped onto this, with the raw value preserved.
 */
export type IncidentSeverity = 1 | 2 | 3;

/**
 * How precisely a source date was stated.
 *
 * 29 fuel deliveries are dated `Mon-YY` with no day. They are anchored to the first of
 * the month and marked `month`, so monthly aggregates stay valid while anything
 * day-level knows not to trust them.
 */
export type DatePrecision = 'day' | 'month';

/** The five source files, used to attribute every data-quality issue. */
export type SourceFile =
  | 'fuel_deliveries.csv'
  | 'electricity_meter_readings.csv'
  | 'incident_register.csv'
  | 'suppliers.csv'
  | 'emission_factors.csv';

/**
 * Robust statistics, shared because two layers need the same test.
 *
 * The ETL uses it to raise the anomaly rules; the API uses it to find the
 * outage month for the correlation view. If they disagreed about what counts as
 * an outlier, the dashboard would narrate an event the data-quality report had
 * not flagged.
 */
export {
  isOutlier,
  median,
  medianAbsoluteDeviation,
  modifiedZScore,
  MIN_RELATIVE_DEVIATION,
  OUTLIER_Z_THRESHOLD,
} from './stats.js';
