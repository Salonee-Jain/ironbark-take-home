/**
 * Reference vocabularies, mirroring what migration 0001 seeds.
 *
 * Held here as well as in the database so the loaders can recognise an
 * unexpected value without a round trip, and so the rule that detects one can
 * be unit-tested with no database at all.
 */

export const KNOWN_SITE_AREAS = new Set([
  'Open Cut - North Pit',
  'Open Cut - South Pit',
  'Processing Plant',
  'Site Services',
  'Haul Fleet',
  'Light Vehicles',
]);

export const KNOWN_INCIDENT_TYPE_CODES = new Set([
  'DUS',
  'VEH',
  'EQP',
  'SLP',
  'ENV',
  'ELE',
  'OTH',
]);
