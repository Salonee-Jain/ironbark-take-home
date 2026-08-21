/**
 * Robust statistics for the anomaly rules.
 *
 * Mean and standard deviation are the wrong tools here: the outlier we are
 * hunting is large enough to drag both of them toward itself, which is how an
 * anomaly hides by being big. Median and median absolute deviation do not move.
 */

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/** Median of absolute deviations from the median. */
export function medianAbsoluteDeviation(values: number[]): number {
  const centre = median(values);
  return median(values.map((v) => Math.abs(v - centre)));
}

/**
 * Modified z-score (Iglewicz and Hoaglin): 0.6745 * (x - median) / MAD. The
 * constant makes it comparable to an ordinary z-score, and |score| > 3.5 is the
 * conventional outlier criterion.
 *
 * Chosen over a multiple of the median, which has to be tuned against the answer
 * you already expect. This adapts to how tightly the series clusters: in a
 * stable series a 40% move is enormous, in a volatile one it is Tuesday.
 */
export function modifiedZScore(value: number, values: number[]): number {
  const mad = medianAbsoluteDeviation(values);
  if (mad === 0) return 0;
  return (0.6745 * (value - median(values))) / mad;
}

export const OUTLIER_Z_THRESHOLD = 3.5;

/**
 * Minimum relative gap from the median before an outlier is worth reporting.
 *
 * A guard against the opposite failure: in a very tightly clustered series the
 * modified z-score will happily call a 3% wobble a 5-sigma event. Something has
 * to be both statistically unusual and materially different to be a finding.
 */
export const MIN_RELATIVE_DEVIATION = 0.2;

export function isOutlier(value: number, values: number[]): boolean {
  const centre = median(values);
  if (centre === 0) return false;

  const relativeDeviation = Math.abs(value - centre) / centre;
  return (
    Math.abs(modifiedZScore(value, values)) > OUTLIER_Z_THRESHOLD &&
    relativeDeviation >= MIN_RELATIVE_DEVIATION
  );
}
