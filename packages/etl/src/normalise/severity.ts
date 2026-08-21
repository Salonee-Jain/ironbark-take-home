import type { IncidentSeverity } from '@ironbark/shared';
import { err, ok, type Result } from './result.js';

/**
 * Incident severity normalisation. The register records severity two ways in one
 * column: Low/Medium on 11 rows, 1/2/3 on 31.
 *
 * Low=1, Medium=2, High=3 assumes both are the same three-point scale written
 * differently. The assumption is stated rather than hidden, and `scale` is
 * returned so the loader can raise the mixed scale as a finding of its own. If
 * the numeric scale ran the other way, every numeric row would be inverted, and
 * INC-2025-118 (surgery) and INC-2025-141 (lost-time injury) both sitting at
 * severity 1 is the evidence for that worry. The AI layer tells them apart by
 * reading the descriptions.
 */

export type SeverityScale = 'numeric' | 'ordinal-text';

export type NormalisedSeverity = {
  severity: IncidentSeverity;
  scale: SeverityScale;
};

const ORDINAL_TO_NUMERIC: Record<string, IncidentSeverity> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function normaliseSeverity(raw: string): Result<NormalisedSeverity> {
  const value = raw.trim();
  if (value === '') return err('severity is empty');

  if (/^[123]$/.test(value)) {
    return ok({
      severity: Number(value) as IncidentSeverity,
      scale: 'numeric',
    });
  }

  const ordinal = ORDINAL_TO_NUMERIC[value.toLowerCase()];
  if (ordinal !== undefined) {
    return ok({ severity: ordinal, scale: 'ordinal-text' });
  }

  // Includes out-of-range numerics like `4` or `0`: better rejected loudly than
  // clamped into a scale they may not belong to.
  return err(`unrecognised severity value: ${raw}`);
}
