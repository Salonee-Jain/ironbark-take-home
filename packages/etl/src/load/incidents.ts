import type { IncidentSeverity } from '@ironbark/shared';
import type { CsvFile } from '../csv.js';
import type { IssueCollector } from '../issues.js';
import { normaliseDate, normaliseSeverity } from '../normalise/index.js';
import { KNOWN_INCIDENT_TYPE_CODES } from '../reference.js';

export type IncidentRecord = {
  id: string;
  sourceIncidentId: string;
  incidentDate: string;
  location: string;
  typeCode: string;
  severity: IncidentSeverity | null;
  severityRaw: string;
  description: string;
  sourceRowNumber: number;
};

/**
 * Fixed infrastructure named in incident descriptions.
 *
 * Kept narrow on purpose. A description mentioning "haul road" is compatible
 * with almost any location, so it is not here; a crusher is a specific piece of
 * plant that cannot be located "at" a vehicle fleet.
 */
const FIXED_INFRASTRUCTURE = [
  'crusher',
  'wash plant',
  'CHPP',
  'ROM pad',
  'thickener',
];

/** Location values that name a fleet rather than a place. */
const FLEET_LOCATIONS = new Set(['Haul Fleet', 'Light Vehicles']);

/**
 * Gap in the ID sequence above which the IDs beyond it look like they came from
 * somewhere else. The main run here is 001-034; the outliers start at 109.
 */
const ID_SEQUENCE_GAP = 20;

export function loadIncidents(
  file: CsvFile,
  issues: IssueCollector,
): IncidentRecord[] {
  const records: IncidentRecord[] = [];

  const seenIds = new Map<string, number>();
  const scaleCounts = new Map<string, number>();
  const descriptionOccurrences = new Map<
    string,
    { id: string; location: string; date: string }[]
  >();

  for (const row of file.rows) {
    const sourceIncidentId = row.value('incident_id').trim();
    const rawDate = row.value('incident_date').trim();
    const location = row.value('location').trim();
    const typeCode = row.value('type_code').trim();
    const rawSeverity = row.value('severity').trim();
    const description = row.value('description').trim();

    const context = {
      sourceRowNumber: row.lineNumber,
      recordKey: sourceIncidentId,
    };

    // --- date ---------------------------------------------------------------
    const date = normaliseDate(rawDate);
    if (!date.ok) {
      issues.add({
        ...context,
        ruleId: 'INC-DUP-ID-01',
        severity: 'error',
        action: 'rejected',
        field: 'incident_date',
        description: `Incident date could not be parsed: ${date.error}. Row excluded.`,
        originalValue: rawDate,
      });
      continue;
    }

    // --- severity -----------------------------------------------------------
    let severity: IncidentSeverity | null = null;
    const parsedSeverity = normaliseSeverity(rawSeverity);

    if (parsedSeverity.ok) {
      severity = parsedSeverity.value.severity;
      scaleCounts.set(
        parsedSeverity.value.scale,
        (scaleCounts.get(parsedSeverity.value.scale) ?? 0) + 1,
      );

      if (parsedSeverity.value.scale === 'ordinal-text') {
        issues.add({
          ...context,
          ruleId: 'INC-SEV-MAPPED-01',
          field: 'severity',
          description: `Text severity "${rawSeverity}" mapped to ${severity} on the numeric scale.`,
          originalValue: rawSeverity,
          resolvedValue: String(severity),
        });
      }
    } else {
      // Loaded with a null severity rather than rejected: the description is
      // the valuable part of an incident record, and the AI layer can still
      // assess it. A guessed severity would be worse than an absent one.
      issues.add({
        ...context,
        ruleId: 'INC-SEV-SCALE-01',
        severity: 'error',
        action: 'flagged',
        field: 'severity',
        description: `Severity "${rawSeverity}" is on neither scale (${parsedSeverity.error}). Loaded without a severity.`,
        originalValue: rawSeverity,
      });
    }

    // --- unknown type code --------------------------------------------------
    if (!KNOWN_INCIDENT_TYPE_CODES.has(typeCode)) {
      issues.add({
        ...context,
        ruleId: 'INC-TYPE-UNKNOWN-01',
        field: 'type_code',
        description: `Type code "${typeCode}" is not in the known set (${[...KNOWN_INCIDENT_TYPE_CODES].join(', ')}).`,
        originalValue: typeCode,
      });
    }

    // --- duplicate ID -------------------------------------------------------
    const timesSeen = seenIds.get(sourceIncidentId) ?? 0;
    let id = sourceIncidentId;

    if (timesSeen > 0) {
      id = `${sourceIncidentId}-${timesSeen + 1}`;
      issues.add({
        ...context,
        ruleId: 'INC-DUP-ID-01',
        field: 'incident_id',
        description:
          `Incident ID already used by a different incident. Both are real events with different dates and ` +
          `descriptions, so this one is kept under the surrogate key ${id}; the register's own ID is preserved.`,
        originalValue: sourceIncidentId,
        resolvedValue: id,
      });
    }
    seenIds.set(sourceIncidentId, timesSeen + 1);

    // --- location vs description -------------------------------------------
    const namedInfrastructure = FIXED_INFRASTRUCTURE.find((keyword) =>
      description.toLowerCase().includes(keyword.toLowerCase()),
    );
    if (namedInfrastructure && FLEET_LOCATIONS.has(location)) {
      issues.add({
        ...context,
        ruleId: 'INC-LOCATION-01',
        field: 'location',
        description: `Description places this at the ${namedInfrastructure}, which is fixed plant, but the location column records "${location}", which is a fleet.`,
        originalValue: location,
      });
    }

    const occurrences = descriptionOccurrences.get(description) ?? [];
    occurrences.push({ id, location, date: date.value.iso });
    descriptionOccurrences.set(description, occurrences);

    records.push({
      id,
      sourceIncidentId,
      incidentDate: date.value.iso,
      location,
      typeCode,
      severity,
      severityRaw: rawSeverity,
      description,
      sourceRowNumber: row.lineNumber,
    });
  }

  // --- mixed severity scales (file level) -----------------------------------
  if (scaleCounts.size > 1) {
    const summary = [...scaleCounts.entries()]
      .map(([scale, count]) => `${scale}: ${count}`)
      .join(', ');
    issues.add({
      ruleId: 'INC-SEV-SCALE-01',
      field: 'severity',
      description:
        `Severity is recorded on two scales in one column (${summary}). Mapped as Low=1, Medium=2, High=3. ` +
        'If the numeric scale actually runs the other way — 1 as most severe, as many mining registers do — then ' +
        'every numeric row is inverted and the safety picture is upside down. Worth confirming with the client.',
      originalValue: summary,
    });
  }

  // --- reused descriptions --------------------------------------------------
  for (const [description, occurrences] of descriptionOccurrences) {
    if (occurrences.length < 2) continue;

    const locations = new Set(occurrences.map((o) => o.location));
    issues.add({
      ruleId: 'INC-DESC-REUSED-01',
      recordKey: occurrences.map((o) => o.id).join(', '),
      field: 'description',
      description:
        `Identical description on ${occurrences.length} incidents across ${locations.size} location(s), ` +
        `between ${occurrences[0]!.date} and ${occurrences[occurrences.length - 1]!.date}: "${description.slice(0, 80)}${description.length > 80 ? '...' : ''}". ` +
        'Either the register is being filled in by copy-paste, or this hazard keeps recurring without being closed out.',
      originalValue: `${occurrences.length} occurrences`,
    });
  }

  // --- IDs outside the main sequence ----------------------------------------
  const numbered = records
    .map((record) => ({
      record,
      number: Number(/(\d+)$/.exec(record.sourceIncidentId)?.[1] ?? NaN),
    }))
    .filter((entry) => Number.isFinite(entry.number))
    .sort((a, b) => a.number - b.number);

  const breakIndex = numbered.findIndex(
    (entry, index) =>
      index > 0 && entry.number - numbered[index - 1]!.number > ID_SEQUENCE_GAP,
  );

  if (breakIndex > 0) {
    const outliers = numbered.slice(breakIndex);
    issues.add({
      ruleId: 'INC-ID-SEQUENCE-01',
      recordKey: outliers.map((o) => o.record.sourceIncidentId).join(', '),
      field: 'incident_id',
      description:
        `${outliers.length} incidents carry IDs far above the main run, which stops at ` +
        `${numbered[breakIndex - 1]!.number} and resumes at ${outliers[0]!.number}. ` +
        'They look merged in from a separate register rather than issued by this one, and they are worth ' +
        'reading as a group — the same records recur under the severity and category findings.',
      originalValue: outliers.map((o) => o.record.sourceIncidentId).join(', '),
    });
  }

  return records;
}
