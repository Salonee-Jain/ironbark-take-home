/**
 * Reference vocabularies, mirroring what migration 0001 seeds, so a loader can
 * recognise an unexpected value without a round trip and the rule that detects
 * one stays unit-testable.
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
