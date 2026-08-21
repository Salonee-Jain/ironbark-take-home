import { describe, expect, it } from 'vitest';
import { findMissing, verifyFindings, type SourceIncident } from './grounding.js';
import type { Finding } from './schema.js';

/**
 * The grounding gate is what makes "an AI wrote this" acceptable in a compliance
 * report. These tests are adversarial: each one is a way a model could produce
 * something convincing and wrong.
 */

const DESCRIPTION =
  'Operator reported ongoing fatigue and poor sleep after four consecutive ' +
  'night shifts on generator duty. Requested confidential support; no injury.';

const INCIDENTS = new Map<string, SourceIncident>([
  ['INC-2026-134', { id: 'INC-2026-134', severity: 1, description: DESCRIPTION }],
  [
    'INC-2025-118',
    {
      id: 'INC-2025-118',
      severity: 1,
      description: 'Fractured forearm; required surgery and lost time.',
    },
  ],
  [
    'INC-2025-900',
    { id: 'INC-2025-900', severity: null, description: 'Minor spill, contained.' },
  ],
]);

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    incident_id: 'INC-2026-134',
    category: 'Psychosocial hazard',
    is_psychosocial: true,
    psychosocial_subtype: 'Excessive workload or fatigue',
    severity_assessment: 2,
    confidence: 0.9,
    evidence_quote: 'ongoing fatigue and poor sleep',
    rationale: 'Sustained fatigue over consecutive night shifts.',
    ...overrides,
  };
}

describe('verifyFindings — what it accepts', () => {
  it('accepts a finding whose quote is present verbatim', () => {
    const { accepted, rejected } = verifyFindings([finding()], INCIDENTS);
    expect(rejected).toHaveLength(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.evidence_quote).toBe('ongoing fatigue and poor sleep');
  });

  it('accepts a quote spanning the whole description', () => {
    const { accepted } = verifyFindings(
      [finding({ evidence_quote: DESCRIPTION })],
      INCIDENTS,
    );
    expect(accepted).toHaveLength(1);
  });

  it('trims surrounding whitespace, the only latitude given', () => {
    const { accepted } = verifyFindings(
      [finding({ evidence_quote: '  ongoing fatigue and poor sleep  ' })],
      INCIDENTS,
    );
    expect(accepted[0]?.evidence_quote).toBe('ongoing fatigue and poor sleep');
  });
});

describe('verifyFindings — what it rejects', () => {
  it('rejects a fabricated quote, however plausible', () => {
    // The core case. Nothing about this quote is unreasonable for the incident;
    // it simply is not what the record says.
    const { accepted, rejected } = verifyFindings(
      [finding({ evidence_quote: 'worker reported severe exhaustion and burnout' })],
      INCIDENTS,
    );
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('quote-not-verbatim');
  });

  it('rejects a quote that is right except for punctuation', () => {
    // The realistic failure: the model tidies while copying. Allowing this
    // would mean "verbatim" quietly meant "close enough".
    const { rejected } = verifyFindings(
      [finding({ evidence_quote: 'Requested confidential support, no injury.' })],
      INCIDENTS,
    );
    expect(rejected[0]?.reason).toBe('quote-not-verbatim');
  });

  it('rejects a quote that differs only in case', () => {
    const { rejected } = verifyFindings(
      [finding({ evidence_quote: 'Ongoing Fatigue And Poor Sleep' })],
      INCIDENTS,
    );
    expect(rejected[0]?.reason).toBe('quote-not-verbatim');
  });

  it('rejects a quote lifted from a different incident', () => {
    // Cross-contamination inside a batch, a real failure mode when eight
    // incidents share one context window.
    const { rejected } = verifyFindings(
      [finding({ evidence_quote: 'required surgery and lost time' })],
      INCIDENTS,
    );
    expect(rejected[0]?.reason).toBe('quote-not-verbatim');
  });

  it('rejects a finding for an incident that does not exist', () => {
    const { accepted, rejected } = verifyFindings(
      [finding({ incident_id: 'INC-9999-999' })],
      INCIDENTS,
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('unknown-incident');
  });

  it('rejects an empty quote', () => {
    const { rejected } = verifyFindings(
      [finding({ evidence_quote: '   ' })],
      INCIDENTS,
    );
    expect(rejected[0]?.reason).toBe('quote-empty');
  });

  it('keeps the first finding per incident and rejects the rest', () => {
    const { accepted, rejected } = verifyFindings(
      [
        finding({ rationale: 'first' }),
        finding({ rationale: 'second', severity_assessment: 3 }),
      ],
      INCIDENTS,
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.rationale).toBe('first');
    expect(rejected[0]?.reason).toBe('duplicate-finding');
  });

  it('rejects one bad finding without taking the good ones with it', () => {
    const { accepted, rejected } = verifyFindings(
      [
        finding(),
        finding({ incident_id: 'INC-9999-999' }),
        finding({
          incident_id: 'INC-2025-118',
          evidence_quote: 'required surgery',
          severity_assessment: 3,
        }),
      ],
      INCIDENTS,
    );
    expect(accepted.map((f) => f.incident_id)).toEqual([
      'INC-2026-134',
      'INC-2025-118',
    ]);
    expect(rejected).toHaveLength(1);
  });

  it('records the rejected quote, so what was discarded stays visible', () => {
    // Rejections are logged, not silently dropped, the artefact has to show
    // what the gate threw away.
    const { rejected } = verifyFindings(
      [finding({ evidence_quote: 'invented text' })],
      INCIDENTS,
    );
    expect(rejected[0]?.quote).toBe('invented text');
    expect(rejected[0]?.detail).toBeTruthy();
  });
});

describe('severity mismatch is computed, never taken from the model', () => {
  it('flags an assessment that disagrees with the register', () => {
    // INC-2025-118: surgery and lost time, recorded as severity 1.
    const { accepted } = verifyFindings(
      [
        finding({
          incident_id: 'INC-2025-118',
          evidence_quote: 'required surgery',
          severity_assessment: 3,
        }),
      ],
      INCIDENTS,
    );
    expect(accepted[0]?.severityMismatch).toBe(true);
    expect(accepted[0]?.recordedSeverity).toBe(1);
  });

  it('does not flag an assessment that agrees', () => {
    const { accepted } = verifyFindings(
      [finding({ severity_assessment: 1 })],
      INCIDENTS,
    );
    expect(accepted[0]?.severityMismatch).toBe(false);
  });

  it('cannot be told a mismatch is absent when the numbers disagree', () => {
    // Even if the model were asked and answered incoherently, the gate derives
    // this from the two numbers rather than believing the report.
    const { accepted } = verifyFindings(
      [
        finding({
          incident_id: 'INC-2025-118',
          evidence_quote: 'required surgery',
          severity_assessment: 3,
        }),
      ],
      INCIDENTS,
    );
    expect(accepted[0]?.severityMismatch).toBe(true);
  });

  it('is not a mismatch when the register recorded no severity at all', () => {
    // Null is absence of a claim, not a claim of zero.
    const { accepted } = verifyFindings(
      [
        finding({
          incident_id: 'INC-2025-900',
          evidence_quote: 'Minor spill, contained.',
          severity_assessment: 2,
        }),
      ],
      INCIDENTS,
    );
    expect(accepted[0]?.severityMismatch).toBe(false);
    expect(accepted[0]?.recordedSeverity).toBeNull();
  });
});

describe('findMissing', () => {
  it('names incidents the model returned nothing usable for', () => {
    const requested = [...INCIDENTS.values()];
    const { accepted } = verifyFindings([finding()], INCIDENTS);
    expect(findMissing(requested, accepted)).toEqual([
      'INC-2025-118',
      'INC-2025-900',
    ]);
  });

  it('counts a rejected finding as missing, not as covered', () => {
    // Silence and a discarded answer are the same thing downstream: no finding.
    const requested = [INCIDENTS.get('INC-2026-134')!];
    const { accepted } = verifyFindings(
      [finding({ evidence_quote: 'fabricated' })],
      INCIDENTS,
    );
    expect(findMissing(requested, accepted)).toEqual(['INC-2026-134']);
  });

  it('is empty when every incident is covered', () => {
    const requested = [INCIDENTS.get('INC-2026-134')!];
    const { accepted } = verifyFindings([finding()], INCIDENTS);
    expect(findMissing(requested, accepted)).toEqual([]);
  });
});
