/**
 * A tiny result type. Normalisers return it rather than throwing, because a bad
 * cell is expected input here: the loader records the failure as a data-quality
 * issue and carries on with the next row.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): Result<T> {
  return { ok: false, error };
}
