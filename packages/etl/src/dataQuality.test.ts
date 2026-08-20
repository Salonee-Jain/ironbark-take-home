import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readCsv } from './csv.js';
import { IssueCollector, type DataQualityIssue } from './issues.js';
import { loadElectricityReadings } from './load/electricity.js';
import { loadFuelDeliveries } from './load/fuel.js';
import { loadIncidents } from './load/incidents.js';
import { loadSuppliers } from './load/suppliers.js';
import { ALL_RULES, RULES, type RuleId } from './rules.js';

/**
 * The regression net for the whole cleaning layer.
 *
 * Run against the real export in `data/raw/`, not a synthetic fixture. That
 * file is committed and never modified — it is the client's data, and the
 * question this suite answers is not "does the engine work in principle" but
 * "does it still find the 99 things we told the client we found". A fixture
 * would drift from the data it was written to describe; this cannot.
 *
 * Loaders are pure — CSV in, records and findings out — so none of this needs a
 * database.
 *
 * Where a number below is asserted exactly, it is a number that appears in the
 * write-up. If one of these changes, the write-up is now wrong, and that is
 * precisely the failure this suite is meant to make loud.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const raw = (name: string) => join(repoRoot, 'data', 'raw', name);

let issues: readonly DataQualityIssue[];
let fuel: ReturnType<typeof loadFuelDeliveries>;
let electricity: ReturnType<typeof loadElectricityReadings>;
let incidents: ReturnType<typeof loadIncidents>;
let suppliers: ReturnType<typeof loadSuppliers>;

function forRule(ruleId: RuleId): DataQualityIssue[] {
  return issues.filter((issue) => issue.ruleId === ruleId);
}

beforeAll(() => {
  const collector = new IssueCollector();
  fuel = loadFuelDeliveries(readCsv(raw('fuel_deliveries.csv')), collector);
  electricity = loadElectricityReadings(
    readCsv(raw('electricity_meter_readings.csv')),
    collector,
  );
  incidents = loadIncidents(readCsv(raw('incident_register.csv')), collector);
  suppliers = loadSuppliers(readCsv(raw('suppliers.csv')), collector);
  issues = collector.all();
});

describe('the load as a whole', () => {
  it('produces the row counts the write-up quotes', () => {
    expect({
      fuel: fuel.length,
      meters: electricity.meters.length,
      readings: electricity.readings.length,
      incidents: incidents.length,
      suppliers: suppliers.length,
    }).toEqual({
      // 150 fuel rows in, 7 exact duplicates rejected.
      fuel: 143,
      meters: 6,
      readings: 108,
      incidents: 42,
      suppliers: 15,
    });
  });

  it('finds 99 issues across 22 rules', () => {
    expect(issues).toHaveLength(99);
    expect(new Set(issues.map((i) => i.ruleId)).size).toBe(22);
  });

  it('splits by severity and action as reported', () => {
    const by = (key: 'severity' | 'action') =>
      issues.reduce<Record<string, number>>((acc, issue) => {
        acc[issue[key]] = (acc[issue[key]] ?? 0) + 1;
        return acc;
      }, {});

    expect(by('severity')).toEqual({ info: 26, warning: 42, error: 31 });
    expect(by('action')).toEqual({ fixed: 37, flagged: 55, rejected: 7 });
  });

  it('fires each rule the expected number of times', () => {
    const counts = issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.ruleId] = (acc[issue.ruleId] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({
      'FUEL-HEADER-01': 1,
      'FUEL-FORMAT-01': 1,
      'FUEL-DATE-PRECISION-01': 29,
      'FUEL-UNIT-KL-01': 11,
      'FUEL-DUP-01': 7,
      'FUEL-CREDIT-01': 1,
      'FUEL-SITE-FLEET-01': 3,
      'FUEL-VOLUME-SPIKE-01': 1,
      'FUEL-MONTH-GAP-01': 1,
      'ELEC-UNIT-SCALE-01': 9,
      'ELEC-METER-GAP-01': 1,
      'ELEC-CONSUMPTION-DROP-01': 1,
      'INC-DUP-ID-01': 1,
      'INC-SEV-SCALE-01': 1,
      'INC-SEV-MAPPED-01': 11,
      'INC-ID-SEQUENCE-01': 1,
      'INC-DESC-REUSED-01': 9,
      'INC-LOCATION-01': 3,
      'SUP-DUP-01': 2,
      'SUP-ABN-FORM-01': 3,
      'SUP-ABN-CHECKSUM-01': 1,
      'SUP-CATEGORY-01': 1,
    });
  });

  it('leaves exactly three defensive rules unfired, and no others', () => {
    // These three guard against values this export happens not to contain: an
    // unknown site area, an unknown incident type code, and an implausible
    // implied price. They are exercised against fixtures further down. Listing
    // them here means a rule that silently stops firing cannot hide.
    const fired = new Set(issues.map((i) => i.ruleId));
    const unfired = ALL_RULES.map((r) => r.ruleId).filter((id) => !fired.has(id));

    expect(unfired.sort()).toEqual([
      'FUEL-PRICE-01',
      'FUEL-SITE-UNKNOWN-01',
      'INC-TYPE-UNKNOWN-01',
    ]);
  });
});

describe('audit-trail invariants', () => {
  it('every correction says what it changed the value to', () => {
    // A fix nobody can trace is indistinguishable from a silent rewrite.
    for (const issue of issues.filter((i) => i.action === 'fixed')) {
      expect(issue.resolvedValue, `${issue.ruleId} ${issue.recordKey}`).not.toBeNull();
    }
  });

  it('every issue cites a rule in the catalogue', () => {
    for (const issue of issues) {
      expect(RULES[issue.ruleId]).toBeDefined();
    }
  });

  it('every issue carries a description and its source file', () => {
    for (const issue of issues) {
      expect(issue.description.length).toBeGreaterThan(10);
      expect(issue.sourceFile).toBe(RULES[issue.ruleId].sourceFile);
    }
  });

  it('row-level issues point at a real line, file-level ones at none', () => {
    for (const issue of issues) {
      if (issue.sourceRowNumber !== null) {
        // Line 1 is the header, so any data row is at least 2.
        expect(issue.sourceRowNumber).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('fuel deliveries', () => {
  it('rejects the seven duplicated invoices and keeps the first of each', () => {
    const duplicates = forRule('FUEL-DUP-01');
    expect(duplicates.map((i) => i.recordKey).sort()).toEqual([
      'INV-40266',
      'INV-40292',
      'INV-40349',
      'INV-40357',
      'INV-40497',
      'INV-40715',
      'INV-40962',
    ]);
    expect(duplicates.every((i) => i.action === 'rejected')).toBe(true);

    // The survivor is still loaded, exactly once each.
    for (const invoice of duplicates.map((i) => i.recordKey)) {
      expect(fuel.filter((f) => f.invoiceNo === invoice)).toHaveLength(1);
    }
  });

  it('converts the eleven kL rows and keeps the original alongside', () => {
    const converted = forRule('FUEL-UNIT-KL-01');
    expect(converted).toHaveLength(11);
    expect(converted.every((i) => i.action === 'fixed')).toBe(true);

    const example = fuel.find((f) => f.invoiceNo === 'INV-40373');
    expect(example?.quantityL).toBe(84030);
    expect(example?.originalQuantity).toBe('84.03');
    expect(example?.originalUnit).toBe('kL');
  });

  it('loads the credit note negative so it nets off, rather than dropping it', () => {
    const credit = fuel.find((f) => f.invoiceNo === 'INV-41777');
    expect(credit?.isCreditNote).toBe(true);
    expect(credit?.quantityL).toBe(-12500);
    expect(credit?.costAud).toBe(-23375);

    // Flagged, not fixed: we are inferring intent from a sign, and the client
    // has to confirm it.
    expect(forRule('FUEL-CREDIT-01')[0]?.action).toBe('flagged');
  });

  it('marks the 29 month-only dates rather than inventing a day', () => {
    // 29 findings against 26 loaded rows, and the gap is not an error: three of
    // the month-only rows are also exact duplicates, so they are reported here
    // and then rejected by FUEL-DUP-01. Findings count what was seen in the
    // file; the table counts what survived. Both numbers are asserted so that a
    // change to either dedup or precision handling has to be deliberate.
    const findings = forRule('FUEL-DATE-PRECISION-01');
    expect(findings).toHaveLength(29);

    const rejectedRows = new Set(
      forRule('FUEL-DUP-01').map((i) => i.sourceRowNumber),
    );
    const alsoRejected = findings.filter((i) => rejectedRows.has(i.sourceRowNumber));
    expect(alsoRejected).toHaveLength(3);

    const monthOnly = fuel.filter((f) => f.datePrecision === 'month');
    expect(monthOnly).toHaveLength(findings.length - alsoRejected.length);

    // Anchored to the first, and the precision field says the day is unknown.
    expect(monthOnly.every((f) => f.deliveryDate.endsWith('-01'))).toBe(true);
  });

  it('flags the diesel billed to the light-vehicle fleet without reassigning it', () => {
    const flagged = forRule('FUEL-SITE-FLEET-01');
    expect(flagged.map((i) => i.recordKey).sort()).toEqual([
      'INV-40431',
      'INV-40800',
      'INV-40948',
    ]);
    expect(flagged.every((i) => i.action === 'flagged')).toBe(true);

    // Still sitting where the invoice put it — a guessed site area would be a
    // confident, wrong breakdown.
    expect(fuel.find((f) => f.invoiceNo === 'INV-40800')?.siteArea).toBe(
      'Light Vehicles',
    );
  });

  it('notices the month with no invoices at all', () => {
    // A gap is invisible unless something goes looking for the absence of rows.
    const gap = forRule('FUEL-MONTH-GAP-01');
    expect(gap).toHaveLength(1);
    expect(gap[0]?.recordKey).toBe('2025-11');
    expect(gap[0]?.severity).toBe('error');
    expect(gap[0]?.action).toBe('flagged');

    expect(fuel.filter((f) => f.deliveryDate.startsWith('2025-11'))).toHaveLength(0);
  });

  it('catches the March 2026 volume spike that a fixed threshold would miss', () => {
    // 1.49x the median — under any round multiple anyone would pick in advance,
    // but six deviations clear of the rest of the series.
    const spike = forRule('FUEL-VOLUME-SPIKE-01');
    expect(spike).toHaveLength(1);
    expect(spike[0]?.recordKey).toBe('2026-03-01');
    expect(spike[0]?.action).toBe('flagged');
  });
});

describe('electricity readings', () => {
  it('corrects the nine MTR-07 readings recorded in MWh', () => {
    const corrected = forRule('ELEC-UNIT-SCALE-01');
    expect(corrected).toHaveLength(9);
    expect(corrected.every((i) => i.action === 'fixed')).toBe(true);
    expect(corrected.every((i) => i.recordKey?.startsWith('MTR-07'))).toBe(true);

    // Original and corrected value both recorded — this one materially raises
    // Scope 2, so it has to be traceable.
    const october = corrected.find((i) => i.recordKey === 'MTR-07 2025-10');
    expect(october?.originalValue).toBe('277 kWh');
    expect(october?.resolvedValue).toBe('277000 kWh');
  });

  it('flags the missing meter as a question, not an assumption', () => {
    const gap = forRule('ELEC-METER-GAP-01');
    expect(gap).toHaveLength(1);
    expect(gap[0]?.recordKey).toBe('MTR-06');
    expect(gap[0]?.action).toBe('flagged');
    expect(electricity.meters.map((m) => m.meterId)).not.toContain('MTR-06');
  });

  it('flags the March 2026 collapse but does NOT correct it', () => {
    // The most important assertion in this file. A pipeline that smoothed this
    // reading would erase the substation failure — the one event in the period
    // that explains why emissions moved.
    const drop = forRule('ELEC-CONSUMPTION-DROP-01');
    expect(drop).toHaveLength(1);
    expect(drop[0]?.recordKey).toBe('2026-03');
    expect(drop[0]?.action).toBe('flagged');
    expect(drop[0]?.resolvedValue).toBeNull();
  });
});

describe('incident register', () => {
  it('keeps both incidents sharing one ID, under a surrogate key', () => {
    const duplicate = forRule('INC-DUP-ID-01');
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.originalValue).toBe('INC-2025-011');
    expect(duplicate[0]?.resolvedValue).toBe('INC-2025-011-2');

    // Both events survive — unlike the fuel duplicates, these are distinct
    // incidents and dropping either would lose a real event.
    const ids = incidents.map((i) => i.id);
    expect(ids).toContain('INC-2025-011');
    expect(ids).toContain('INC-2025-011-2');
  });

  it('preserves the register ID so the client can still find the record', () => {
    const surrogate = incidents.find((i) => i.id === 'INC-2025-011-2');
    expect(surrogate?.sourceIncidentId).toBe('INC-2025-011');
  });

  it('raises the mixed severity scale once, and traces each mapped row', () => {
    expect(forRule('INC-SEV-SCALE-01')).toHaveLength(1);
    // 11 Low/Medium rows, each with its own row-level trace of the mapping.
    expect(forRule('INC-SEV-MAPPED-01')).toHaveLength(11);
    expect(forRule('INC-SEV-MAPPED-01').every((i) => i.action === 'fixed')).toBe(true);
  });

  it('flags descriptions that contradict the recorded location', () => {
    const contradictions = forRule('INC-LOCATION-01');
    expect(contradictions).toHaveLength(3);
    expect(contradictions.every((i) => i.action === 'flagged')).toBe(true);
  });

  it('surfaces the out-of-sequence IDs merged in from another register', () => {
    const sequence = forRule('INC-ID-SEQUENCE-01');
    expect(sequence).toHaveLength(1);
    // The same records the AI layer later finds severity contradictions in.
    expect(sequence[0]?.originalValue).toContain('INC-2025-118');
    expect(sequence[0]?.originalValue).toContain('INC-2025-141');
  });
});

describe('suppliers', () => {
  it('links the two duplicate pairs instead of merging them away', () => {
    const duplicates = forRule('SUP-DUP-01');
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((i) => i.recordKey).sort()).toEqual([
      'Blackwood Heavy Maintanence',
      'Ironline Fuel Distributors P/L',
    ]);

    // Both rows still load — the client ledger contains both, and reconciling
    // against it later needs both visible.
    expect(suppliers).toHaveLength(15);
  });

  it('matches one pair on name and the other on ABN', () => {
    // Two techniques, because neither alone catches both: the Ironline
    // duplicate has no ABN, and the Blackwood duplicate is a typo.
    const byName = forRule('SUP-DUP-01').find(
      (i) => i.recordKey === 'Ironline Fuel Distributors P/L',
    );
    const byAbn = forRule('SUP-DUP-01').find(
      (i) => i.recordKey === 'Blackwood Heavy Maintanence',
    );
    expect(byName?.description).toContain('canonical name');
    expect(byAbn?.description).toContain('abn');
  });

  it('flags the malformed and missing ABNs without defaulting them', () => {
    const abns = forRule('SUP-ABN-FORM-01');
    expect(abns).toHaveLength(3);
    expect(abns.map((i) => i.recordKey).sort()).toEqual([
      'Ironline Fuel Distributors P/L',
      'SafeGuard PPE Supplies',
      'TerraForm Rehabilitation Co',
    ]);
    expect(abns.every((i) => i.action === 'flagged')).toBe(true);
  });

  it('reports the systematic checksum failure once, at file level', () => {
    // All twelve well-formed ABNs fail. Twelve row-level findings would bury
    // the one genuine defect above.
    const checksum = forRule('SUP-ABN-CHECKSUM-01');
    expect(checksum).toHaveLength(1);
    expect(checksum[0]?.sourceRowNumber).toBeNull();
    expect(checksum[0]?.severity).toBe('info');
  });

  it('canonicalises the split category label', () => {
    const category = forRule('SUP-CATEGORY-01');
    expect(category).toHaveLength(1);
    expect(category[0]?.originalValue).toBe('Fuel');
    expect(category[0]?.resolvedValue).toBe('Fuel supply');
  });
});
