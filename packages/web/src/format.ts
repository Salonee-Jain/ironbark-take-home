/** Presentation helpers. Nothing here changes a value, only how it reads. */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** `2026-03` -> `Mar 26`. */
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  const name = MONTH_NAMES[Number(monthNumber) - 1] ?? month;
  return `${name} ${year?.slice(2) ?? ''}`;
}

/** `2026-03` -> `March 2026`, for prose and tooltips. */
export function monthLabelLong(month: string): string {
  const [year, monthNumber] = month.split('-');
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${names[Number(monthNumber) - 1] ?? month} ${year}`;
}

export function kgToTonnes(kg: number): number {
  return kg / 1000;
}

/** Tonnes, no unit suffix — the axis or label carries the unit. */
export function tonnes(kg: number, digits = 0): string {
  return kgToTonnes(kg).toLocaleString('en-AU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function count(value: number): string {
  return value.toLocaleString('en-AU');
}

export function percent(value: number | null, digits = 1): string {
  if (value === null) return '—';
  return `${value.toFixed(digits)}%`;
}

/** Signed percentage, for period-on-period deltas. */
export function signedPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function aud(value: number): string {
  return value.toLocaleString('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  });
}
