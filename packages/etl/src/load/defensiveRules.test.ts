import { describe, expect, it } from 'vitest';
import { parseCsv } from '../csv.js';
import { IssueCollector } from '../issues.js';
import { loadFuelDeliveries } from './fuel.js';
import { loadIncidents } from './incidents.js';

/**
 * The three rules the real export never triggers.
 *
 * `dataQuality.test.ts` asserts that these stay silent against `data/raw/`, and
 * that assertion is only worth anything if the rules can be shown to fire at
 * all. Without this file, a rule that had been quietly broken would look
 * identical to a rule that simply had nothing to report.
 *
 * These are the smallest fixtures that trigger each one — a valid header and
 * one bad row.
 */

const FUEL_HEADER =
  'Invoice No, Delivery Date,Fuel Type ,Quantity, Unit,Cost (AUD),Site Area';
const INCIDENT_HEADER =
  'incident_id,incident_date,location,type_code,severity,description';

function loadFuel(...rows: string[]) {
  const issues = new IssueCollector();
  const records = loadFuelDeliveries(
    parseCsv([FUEL_HEADER, ...rows].join('\n'), 'fixture'),
    issues,
  );
  return { records, issues: issues.all() };
}

function loadIncidentRows(...rows: string[]) {
  const issues = new IssueCollector();
  const records = loadIncidents(
    parseCsv([INCIDENT_HEADER, ...rows].join('\n'), 'fixture'),
    issues,
  );
  return { records, issues: issues.all() };
}

describe('FUEL-PRICE-01 — implied price outside the plausible band', () => {
  it('fires on a kL quantity that was not converted', () => {
    // The scenario the rule exists for: both columns look individually
    // reasonable, and only their ratio (~$1,813/L) gives the error away.
    const { issues } = loadFuel(
      'INV-40001,2025-06-15,Diesel,84.03,L,"$152,369.51",Processing Plant',
    );
    const price = issues.filter((i) => i.ruleId === 'FUEL-PRICE-01');
    expect(price).toHaveLength(1);
    expect(price[0]?.severity).toBe('error');
    // Flagged, not fixed — the check knows one of the two numbers is wrong but
    // not which one.
    expect(price[0]?.action).toBe('flagged');
  });

  it('fires on a stray factor of ten in the other direction', () => {
    const { issues } = loadFuel(
      'INV-40002,2025-06-15,Diesel,125000,L,"$23,375.00",Haul Fleet',
    );
    expect(issues.some((i) => i.ruleId === 'FUEL-PRICE-01')).toBe(true);
  });

  it('stays silent on an ordinary delivery', () => {
    const { issues } = loadFuel(
      'INV-40003,2025-06-15,Diesel,12500,L,"$23,375.00",Haul Fleet',
    );
    expect(issues.some((i) => i.ruleId === 'FUEL-PRICE-01')).toBe(false);
  });

  it('stays silent once the kL row is correctly labelled', () => {
    // Same numbers as the first case, with the unit the file should have had.
    const { issues } = loadFuel(
      'INV-40004,2025-06-15,Diesel,84.03,kL,"$152,369.51",Processing Plant',
    );
    expect(issues.some((i) => i.ruleId === 'FUEL-PRICE-01')).toBe(false);
    expect(issues.some((i) => i.ruleId === 'FUEL-UNIT-KL-01')).toBe(true);
  });
});

describe('FUEL-SITE-UNKNOWN-01 — site area outside the taxonomy', () => {
  it('fires on an area not in the seeded reference list', () => {
    const { records, issues } = loadFuel(
      'INV-40005,2025-06-15,Diesel,12500,L,"$23,375.00",West Pit Extension',
    );
    const unknown = issues.filter((i) => i.ruleId === 'FUEL-SITE-UNKNOWN-01');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.originalValue).toBe('West Pit Extension');

    // The row still loads. Dropping it would lose real fuel; silently adding
    // the area to the taxonomy would hide that the export disagrees with the
    // reference data.
    expect(records).toHaveLength(1);
  });

  it.each([
    'Open Cut - North Pit',
    'Open Cut - South Pit',
    'Processing Plant',
    'Site Services',
    'Haul Fleet',
  ])('stays silent on the known area %s', (area) => {
    const { issues } = loadFuel(
      `INV-40006,2025-06-15,Diesel,12500,L,"$23,375.00",${area}`,
    );
    expect(issues.some((i) => i.ruleId === 'FUEL-SITE-UNKNOWN-01')).toBe(false);
  });
});

describe('INC-TYPE-UNKNOWN-01 — incident type code outside the known set', () => {
  it('fires on an unrecognised code', () => {
    const { records, issues } = loadIncidentRows(
      'INC-2025-500,15/06/2025,Haul Fleet,XYZ,2,"Something happened on site."',
    );
    const unknown = issues.filter((i) => i.ruleId === 'INC-TYPE-UNKNOWN-01');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.originalValue).toBe('XYZ');
    expect(unknown[0]?.severity).toBe('error');

    // Surfaced, not quietly promoted into a new category.
    expect(records).toHaveLength(1);
  });

  it.each(['DUS', 'VEH', 'EQP', 'SLP', 'ENV', 'ELE', 'OTH'])(
    'stays silent on the known code %s',
    (code) => {
      const { issues } = loadIncidentRows(
        `INC-2025-501,15/06/2025,Haul Fleet,${code},2,"Something happened on site."`,
      );
      expect(issues.some((i) => i.ruleId === 'INC-TYPE-UNKNOWN-01')).toBe(false);
    },
  );
});
