import { NotFoundError } from '../errors.js';
import * as repository from '../repositories/incidents.repository.js';
import { camelCaseKeys, camelCaseRows } from '../utils/case.js';

export type IncidentQuery = {
  month?: string;
  type?: string;
  severity?: number;
  psychosocial?: boolean;
};

export async function listIncidents(query: IncidentQuery) {
  const rows = await repository.findIncidents({
    month: query.month ? `${query.month}-01` : null,
    typeCode: query.type ?? null,
    severity: query.severity ?? null,
    psychosocial: query.psychosocial ?? null,
  });
  return { incidents: camelCaseRows(rows), total: rows.length };
}

export async function getTrends() {
  const [byMonth, byType, bySeverity] = await Promise.all([
    repository.countByMonth(),
    repository.countByType(),
    repository.countBySeverity(),
  ]);

  return {
    byMonth: camelCaseRows(byMonth),
    byType: camelCaseRows(byType),
    bySeverity: camelCaseRows(bySeverity),
  };
}

/**
 * One incident with its full audit trail.
 *
 * The grounding check is the reason this endpoint exists in this shape. The
 * database trigger already refuses to store a finding whose evidence quote is
 * not verbatim in the incident, and it is re-verified here on every read.
 *
 * That is deliberate belt-and-braces: the storage guarantee protects the data,
 * and this one puts the evidence in front of whoever is reading, so a
 * compliance user is shown that a claim is traceable rather than asked to take
 * it on trust. If `evidenceVerified` is ever false, something is badly wrong
 * and the UI should say so loudly rather than render the finding as fact.
 */
export async function getIncidentDetail(id: string) {
  const incident = await repository.findIncidentById(id);

  if (!incident) {
    throw new NotFoundError(
      `No incident with id ${id}`,
      'Incident IDs look like INC-2025-001. Duplicated source IDs carry a -2 suffix.',
    );
  }

  const [issues, findings] = await Promise.all([
    repository.findIssuesForSourceRow(incident.source_row_number),
    repository.findAiFindings(id),
  ]);

  return {
    incident: camelCaseKeys(incident),
    dataQualityIssues: camelCaseRows(issues),
    aiFindings: findings.map((finding) => ({
      ...camelCaseKeys(finding),
      evidenceVerified: incident.description.includes(finding.evidence_quote),
    })),
  };
}
