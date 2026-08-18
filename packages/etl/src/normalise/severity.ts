import type { IncidentSeverity } from '@ironbark/shared';
import { err, ok, type Result } from './result.js';

/**
 * Incident severity normalisation.
 *
 * The register records severity two different ways, in the same column:
 * `Low`/`Medium` on 11 rows and `1`/`2`/`3` on 31. Someone changed system or
 * convention partway through and nobody backfilled.
 *
 * The mapping used is Low=1, Medium=2, High=3 — the two scales are assumed to
 * be the same three-point scale written differently. That assumption is stated
 * rather than hidden, and `scale` is returned so the loader can raise the
 * mixed-scale problem as a data-quality issue in its own right. It matters:
 * "severity 1" and "Low" look equivalent, but if the numeric scale actually ran
 * the other way (1 = most severe, as many mining registers do) then every
 * numeric row is inverted.
 *
 * There is evidence for that worry in the data. INC-2025-118 — a fractured
 * forearm requiring surgery — is recorded as severity 1, alongside INC-2025-141,
 * a lost-time injury needing sutures. Both are the *least* severe value on the
 * assumed scale. Either the scale is inverted or those records are miscoded;
 * the AI layer in step 7 is what tells them apart, by reading the descriptions.
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
