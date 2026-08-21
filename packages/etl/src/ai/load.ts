import type { PoolClient } from 'pg';
import { readCache } from './cache.js';
import { verifyFindings, type SourceIncident } from './grounding.js';

/**
 * Loads cached AI findings into the database, at the end of every ETL run: the
 * load replaces `incidents` and the findings cascade with it.
 *
 * Scoped to one company, so a tenant that uploaded its own register finds no
 * matching incident IDs and loads nothing. The grounding gate runs again here
 * against the freshly loaded descriptions, because a cache is a file in a
 * repository and a finding grounded when generated is not necessarily grounded
 * now.
 */

export type AiLoadResult = {
  loaded: number;
  rejected: number;
  skippedMissingIncident: number;
  psychosocial: number;
  severityMismatches: number;
  model: string;
  promptVersion: string;
} | null;

export async function loadAiFindings(
  client: PoolClient,
  companyId: number,
): Promise<AiLoadResult> {
  const cache = readCache();
  if (!cache || cache.findings.length === 0) return null;

  const { rows } = await client.query<{
    id: string;
    severity: number | null;
    description: string;
  }>('select id, severity, description from incidents where company_id = $1', [
    companyId,
  ]);

  const byId = new Map<string, SourceIncident>(rows.map((r) => [r.id, r]));

  const known = cache.findings.filter((f) => byId.has(f.incident_id));
  const skippedMissingIncident = cache.findings.length - known.length;

  const { accepted, rejected } = verifyFindings(known, byId);

  for (const finding of accepted) {
    await client.query(
      `insert into ai_incident_findings (
         company_id, incident_id, category, is_psychosocial, severity_assessment,
         severity_mismatch, confidence, evidence_quote, rationale,
         model, prompt_version
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (company_id, incident_id, model, prompt_version) do nothing`,
      [
        companyId,
        finding.incident_id,
        finding.category,
        finding.is_psychosocial,
        finding.severity_assessment,
        finding.severityMismatch,
        finding.confidence,
        finding.evidence_quote,
        finding.rationale,
        cache.model,
        cache.promptVersion,
      ],
    );
  }

  return {
    loaded: accepted.length,
    rejected: rejected.length,
    skippedMissingIncident,
    psychosocial: accepted.filter((f) => f.is_psychosocial).length,
    severityMismatches: accepted.filter((f) => f.severityMismatch).length,
    model: cache.model,
    promptVersion: cache.promptVersion,
  };
}
