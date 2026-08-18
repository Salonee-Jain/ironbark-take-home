/**
 * A tiny result type.
 *
 * Normalisers return this rather than throwing, because a bad cell is expected
 * input for this pipeline, not an exceptional condition. The loader needs to
 * record the failure as a data-quality issue and carry on with the next row —
 * exceptions would make "keep going, but remember" the awkward path.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
