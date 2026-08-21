import { NotFoundError } from '../errors.js';
import * as repository from '../repositories/incidents.repository.js';
import { camelCaseKeys, camelCaseRows } from '../utils/case.js';

export type IncidentQuery = {
  month?: string;
  from?: string;
  to?: string;
  type?: string;
  severity?: number;
  psychosocial?: boolean;
  search?: string;
};

/** `2026-03` -> `2026-03-01`. Blank and absent both mean "no bound". */
function toMonthStart(month: string | undefined): string | null {
  return month ? `${month}-01` : null;
}

/** Blank strings arrive from cleared form fields; they are not a filter. */
function toSearch(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export async function listIncidents(companyId: number, query: IncidentQuery) {
  const rows = await repository.findIncidents(companyId, {
    month: toMonthStart(query.month),
    from: toMonthStart(query.from),
    to: toMonthStart(query.to),
    typeCode: query.type ?? null,
    severity: query.severity ?? null,
    psychosocial: query.psychosocial ?? null,
    search: toSearch(query.search),
  });
  return { incidents: camelCaseRows(rows), total: rows.length };
}

export async function getTrends(
  companyId: number,
  query: { from?: string; to?: string } = {},
) {
  const range = { from: toMonthStart(query.from), to: toMonthStart(query.to) };
  const [byMonth, byType, bySeverity] = await Promise.all([
    repository.countByMonth(companyId, range),
    repository.countByType(companyId, range),
    repository.countBySeverity(companyId, range),
  ]);

  return {
    byMonth: camelCaseRows(byMonth),
    byType: camelCaseRows(byType),
    bySeverity: camelCaseRows(bySeverity),
  };
}

/**
 * One incident with its full audit trail. The database trigger already refuses
 * to store a finding whose quote is not verbatim in the incident, and it is
 * re-verified here on every read: the storage guarantee protects the data, this
 * puts the evidence in front of whoever is reading.
 */
export async function getIncidentDetail(companyId: number, id: string) {
  const incident = await repository.findIncidentById(companyId, id);

  if (!incident) {
    throw new NotFoundError(
      `No incident with id ${id}`,
      'Incident IDs look like INC-2025-001. Duplicated source IDs carry a -2 suffix.',
    );
  }

  const [issues, findings] = await Promise.all([
    repository.findIssuesForSourceRow(companyId, incident.source_row_number),
    repository.findAiFindings(companyId, id),
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
