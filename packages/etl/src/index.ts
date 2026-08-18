/**
 * ETL entry point.
 *
 * Reads the untouched source files from `data/raw/`, normalises them, records every
 * problem it finds in `data_quality_issues`, and loads the result into Postgres.
 *
 * Implemented in steps 3 and 4 — see PLAN.md.
 */

export async function run(): Promise<void> {
  throw new Error('ETL pipeline not implemented yet (PLAN.md steps 3-4)');
}

await run();
