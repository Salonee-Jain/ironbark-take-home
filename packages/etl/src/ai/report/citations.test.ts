import { describe, expect, it } from 'vitest';
import {
  extractNumbers,
  numberMatches,
  verifyClaims,
} from './citations.js';
import { factDigest } from './facts.js';
import type { ReportFact } from './facts.js';
import type { Claim } from './schema.js';

/**
 * The citation gate, tested at the same depth as the grounding gate and for the
 * same reason: it is the only thing standing between a generated sentence and a
 * compliance document.
 *
 * The cases below are the failures that matter: a fabricated figure wearing a
 * real citation, a record named without being cited, a fact id that does not
 * exist, plus the roundings a correct writer is entitled to make.
 */

const FACTS: ReportFact[] = [
  {
    id: 'EMISSIONS-TOTAL-T',
    kind: 'metric',
    label: 'Total emissions for the whole period, Scope 1 plus Scope 2',
    value: 30189.4,
    unit: 't CO2e',
    source: 'v_monthly_emissions_totals',
    detail: null,
  },
  {
    id: 'EMISSIONS-SCOPE1-SHARE-PCT',
    kind: 'metric',
    label: 'Share of the period total that is Scope 1',
    value: 47.3,
    unit: '%',
    source: 'v_monthly_emissions_totals',
    detail: null,
  },
  {
    id: 'AI-PSYCHOSOCIAL-COUNT',
    kind: 'metric',
    label: 'Incidents identified as psychosocial hazards',
    value: 4,
    unit: 'incidents',
    source: 'ai_incident_findings',
    detail: null,
  },
  {
    id: 'INC-2025-118',
    kind: 'record',
    label: 'Incident INC-2025-118, recorded severity contradicted by its description',
    value: '2025-06-14',
    unit: null,
    source: 'incident_register.csv + ai_incident_findings',
    detail:
      'recorded severity 1, assessed from the text as 3. Description: "Worker fractured forearm, surgery required".',
  },
  {
    id: 'INC-2025-127',
    kind: 'record',
    label: 'Incident INC-2025-127, classified as a psychosocial hazard',
    value: '2025-07-02',
    unit: null,
    source: 'incident_register.csv + ai_incident_findings',
    detail: 'coded OTH in the register, recorded severity 1.',
  },
];

const claim = (text: string, citations: string[]): Claim => ({
  section: 'Emissions',
  text,
  citations,
});

describe('extractNumbers', () => {
  it('reads plain, grouped, decimal and negative figures', () => {
    expect(extractNumbers('30189.4 t, 1,219,185 kg, -65% and 4').map((n) => n.value)).toEqual([
      30189.4, 1219185, -65, 4,
    ]);
  });

  it('normalises a unicode minus, which models emit freely', () => {
    // Left alone, `−65%` parses as 65 and a correct claim looks fabricated.
    expect(extractNumbers('−65%')[0]?.value).toBe(-65);
  });
});

describe('numberMatches', () => {
  it('accepts an exact figure', () => {
    expect(numberMatches({ token: '47.3', value: 47.3 }, 47.3)).toBe(true);
  });

  it('accepts rounding to the precision written', () => {
    expect(numberMatches({ token: '47', value: 47 }, 47.3)).toBe(true);
    expect(numberMatches({ token: '1219185', value: 1219185 }, 1219184.94)).toBe(true);
  });

  it('refuses a rounding beyond the precision written', () => {
    expect(numberMatches({ token: '47.0', value: 47 }, 47.3)).toBe(false);
  });

  it('refuses a change of magnitude dressed up as a rounding', () => {
    // "10.2 million" for 10153109.86 is the failure this rule exists to stop:
    // it reads as a helpful summary and is not checkable against anything.
    expect(numberMatches({ token: '10.2', value: 10.2 }, 10153109.86)).toBe(false);
  });
});

describe('verifyClaims', () => {
  it('accepts a claim whose every figure is in a cited fact', () => {
    const { accepted, rejected } = verifyClaims(
      [
        claim('The site emitted 30189.4 t CO2e across the period.', [
          'EMISSIONS-TOTAL-T',
        ]),
      ],
      FACTS,
    );

    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
  });

  it('accepts a figure rounded to the precision written', () => {
    const { accepted } = verifyClaims(
      [claim('Scope 1 is 47% of the period total.', ['EMISSIONS-SCOPE1-SHARE-PCT'])],
      FACTS,
    );
    expect(accepted).toHaveLength(1);
  });

  it('rejects a fabricated figure wearing a real citation', () => {
    // The most dangerous output this project can produce: a wrong number that
    // looks *more* trustworthy than an uncited one because it carries a source.
    const { accepted, rejected } = verifyClaims(
      [
        claim('The site emitted 42000 t CO2e across the period.', [
          'EMISSIONS-TOTAL-T',
        ]),
      ],
      FACTS,
    );

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('unsupported-number');
    expect(rejected[0]?.detail).toContain('42000');
  });

  it('rejects a derived figure the pack never stated', () => {
    // 30189.4 and 47.3 are both facts; their product is not, and a model that
    // multiplies them has done arithmetic nobody can audit.
    const { rejected } = verifyClaims(
      [
        claim('Scope 1 accounts for 14279.6 t of the total.', [
          'EMISSIONS-TOTAL-T',
          'EMISSIONS-SCOPE1-SHARE-PCT',
        ]),
      ],
      FACTS,
    );
    expect(rejected[0]?.reason).toBe('unsupported-number');
  });

  it('rejects a claim citing a fact that does not exist', () => {
    const { rejected } = verifyClaims(
      [claim('Total emissions were 30189.4 t.', ['EMISSIONS-TOTAL-INVENTED'])],
      FACTS,
    );
    expect(rejected[0]?.reason).toBe('unknown-fact');
    expect(rejected[0]?.detail).toContain('EMISSIONS-TOTAL-INVENTED');
  });

  it('rejects an uncited claim outright', () => {
    const { rejected } = verifyClaims(
      [claim('Safety performance improved over the period.', [])],
      FACTS,
    );
    expect(rejected[0]?.reason).toBe('no-citations');
  });

  it('rejects a record named in the prose but left out of the citations', () => {
    const { rejected } = verifyClaims(
      [
        claim('Four incidents were psychosocial, including INC-2025-127.', [
          'AI-PSYCHOSOCIAL-COUNT',
        ]),
      ],
      FACTS,
    );
    expect(rejected[0]?.reason).toBe('uncited-record');
    expect(rejected[0]?.detail).toContain('INC-2025-127');
  });

  it('does not treat the digits of a cited record id as figures to verify', () => {
    // `INC-2025-118` contains 2025 and 118. Neither is a quantity, and a gate
    // that demanded a fact for them would reject every correct sentence that
    // names a record.
    const { accepted } = verifyClaims(
      [
        claim(
          'INC-2025-118 is recorded at severity 1 but the description reports surgery.',
          ['INC-2025-118'],
        ),
      ],
      FACTS,
    );
    expect(accepted).toHaveLength(1);
  });

  it('allows numbers drawn from the detail of a cited record', () => {
    const { accepted } = verifyClaims(
      [
        claim('INC-2025-118 was assessed from its text as severity 3.', [
          'INC-2025-118',
        ]),
      ],
      FACTS,
    );
    expect(accepted).toHaveLength(1);
  });

  it('allows a bare year, which is a date rather than a quantity', () => {
    const { accepted } = verifyClaims(
      [claim('Four psychosocial hazards were identified in 2025.', ['AI-PSYCHOSOCIAL-COUNT'])],
      FACTS,
    );
    expect(accepted).toHaveLength(1);
  });

  it('keeps a good claim when a neighbouring one fails', () => {
    // The reason a claim is the unit of verification rather than the report:
    // one bad sentence costs one sentence.
    const { accepted, rejected } = verifyClaims(
      [
        claim('Total emissions were 30189.4 t CO2e.', ['EMISSIONS-TOTAL-T']),
        claim('Total emissions were 99999 t CO2e.', ['EMISSIONS-TOTAL-T']),
      ],
      FACTS,
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

describe('factDigest', () => {
  it('is stable for the same pack', () => {
    expect(factDigest(FACTS)).toBe(factDigest([...FACTS]));
  });

  it('changes when a value changes', () => {
    const moved = FACTS.map((fact) =>
      fact.id === 'EMISSIONS-TOTAL-T' ? { ...fact, value: 30189.5 } : fact,
    );
    expect(factDigest(moved)).not.toBe(factDigest(FACTS));
  });

  it('changes when the pack is reordered', () => {
    // Order is part of the prompt, so a reordered pack is a different question
    // and must not be able to claim a cached report written for the other one.
    expect(factDigest([...FACTS].reverse())).not.toBe(factDigest(FACTS));
  });
});
