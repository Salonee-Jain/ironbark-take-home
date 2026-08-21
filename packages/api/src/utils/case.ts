/**
 * snake_case to camelCase, at the service boundary.
 *
 * Done once, generically, with the type transformation mirrored at compile time,
 * so `row.scope1KgCo2e` is checked and a typo is a build error rather than an
 * undefined that renders as a blank tile.
 *
 * Here rather than in SQL aliases, because quoted mixed-case identifiers in
 * Postgres are a lasting annoyance for anyone querying by hand.
 */

export type CamelCase<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : S;

export type CamelCaseKeys<T> = {
  [K in keyof T as CamelCase<K & string>]: T[K];
};

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );
}

export function camelCaseKeys<T extends Record<string, unknown>>(
  row: T,
): CamelCaseKeys<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[toCamel(key)] = value;
  }
  return result as CamelCaseKeys<T>;
}

export function camelCaseRows<T extends Record<string, unknown>>(
  rows: T[],
): CamelCaseKeys<T>[] {
  return rows.map(camelCaseKeys);
}
