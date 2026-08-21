import type { Finding } from './schema.js';

/**
 * The grounding gate. Nothing reaches the database without passing through here;
 * the database enforces the same rule with a trigger and the API re-checks it on
 * read.
 *
 * Severity mismatch is computed here rather than asked of the model. Asking a
 * model to report the consequence of its own answer invites an incoherent pair.
 */

export type SourceIncident = {
  id: string;
  severity: number | null;
  description: string;
};

export type GroundedFinding = Finding & {
  /** Computed, not model-reported. */
  severityMismatch: boolean;
  recordedSeverity: number | null;
};

export type Rejection = {
  incidentId: string;
  reason:
    | 'unknown-incident'
    | 'quote-not-verbatim'
    | 'quote-empty'
    | 'duplicate-finding';
  detail: string;
  quote: string;
};

export type GroundingResult = {
  accepted: GroundedFinding[];
  rejected: Rejection[];
};

export function verifyFindings(
  findings: Finding[],
  incidentsById: Map<string, SourceIncident>,
): GroundingResult {
  const accepted: GroundedFinding[] = [];
  const rejected: Rejection[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    const incident = incidentsById.get(finding.incident_id);

    if (!incident) {
      rejected.push({
        incidentId: finding.incident_id,
        reason: 'unknown-incident',
        detail: 'No incident with this id exists in the register.',
        quote: finding.evidence_quote,
      });
      continue;
    }

    if (seen.has(finding.incident_id)) {
      rejected.push({
        incidentId: finding.incident_id,
        reason: 'duplicate-finding',
        detail: 'A finding for this incident was already accepted in this run.',
        quote: finding.evidence_quote,
      });
      continue;
    }

    const quote = finding.evidence_quote.trim();
    if (quote === '') {
      rejected.push({
        incidentId: finding.incident_id,
        reason: 'quote-empty',
        detail: 'Evidence quote is empty.',
        quote: finding.evidence_quote,
      });
      continue;
    }

    // Verbatim, with no normalisation. Trimming surrounding whitespace is the
    // only latitude given: allowing case-insensitive or punctuation-insensitive
    // matching would let a quote drift from the source while still "passing",
    // which is the failure this gate exists to prevent.
    if (!incident.description.includes(quote)) {
      rejected.push({
        incidentId: finding.incident_id,
        reason: 'quote-not-verbatim',
        detail: 'Evidence quote does not appear in the source description.',
        quote,
      });
      continue;
    }

    seen.add(finding.incident_id);
    accepted.push({
      ...finding,
      evidence_quote: quote,
      recordedSeverity: incident.severity,
      severityMismatch:
        incident.severity !== null &&
        finding.severity_assessment !== incident.severity,
    });
  }

  return { accepted, rejected };
}

/** Incidents the model was asked about but returned no accepted finding for. */
export function findMissing(
  requested: SourceIncident[],
  accepted: GroundedFinding[],
): string[] {
  const covered = new Set(accepted.map((f) => f.incident_id));
  return requested.filter((i) => !covered.has(i.id)).map((i) => i.id);
}
