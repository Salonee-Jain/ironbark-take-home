import { getPool } from '@ironbark/db';
import type { PoolClient } from 'pg';

/**
 * The load audit trail.
 *
 * Uploads replace a company's dataset, so this table is the only record that a
 * load ever happened, who ran it, and what it produced. "Which upload is behind
 * the number in last quarter's report" is a question a compliance tool has to
 * be able to answer, and after a replace the fact tables cannot answer it.
 */

export type DataLoadRow = {
  id: number;
  company_id: number;
  uploaded_by_user_id: number | null;
  uploaded_by_email: string | null;
  source: 'upload' | 'cli';
  files: { role: string; name: string; bytes: number }[];
  row_counts: Record<string, number>;
  issue_count: number;
  error_count: number;
  status: 'succeeded' | 'failed';
  failure_reason: string | null;
  started_at: Date;
  finished_at: Date | null;
};

const RETURNING = `
  returning id, company_id, uploaded_by_user_id, uploaded_by_email, source,
            files, row_counts, issue_count, error_count, status, failure_reason,
            started_at, finished_at`;

/**
 * Record a successful load.
 *
 * Takes the caller's client rather than the pool so the audit row commits with
 * the data it describes. A load that succeeded but whose audit row was written
 * separately can end up with one committed and the other not.
 */
export async function recordLoad(
  client: PoolClient,
  input: {
    companyId: number;
    userId: number;
    email: string;
    files: unknown;
    rowCounts: unknown;
    issueCount: number;
    errorCount: number;
  },
): Promise<DataLoadRow> {
  const { rows } = await client.query<DataLoadRow>(
    `insert into data_loads (
       company_id, uploaded_by_user_id, uploaded_by_email, source,
       files, row_counts, issue_count, error_count, status, finished_at
     ) values ($1, $2, $3, 'upload', $4, $5, $6, $7, 'succeeded', now())
     ${RETURNING}`,
    [
      input.companyId,
      input.userId,
      input.email,
      JSON.stringify(input.files),
      JSON.stringify(input.rowCounts),
      input.issueCount,
      input.errorCount,
    ],
  );
  return rows[0]!;
}

/**
 * Record a rejected load.
 *
 * Uses the pool, not the caller's client, and that is the whole point: the
 * transaction this is describing has already been rolled back, so writing the
 * audit row inside it would roll the audit row back too and leave no evidence
 * that anyone tried.
 */
export async function recordFailedLoad(input: {
  companyId: number;
  userId: number;
  email: string;
  files: unknown;
  reason: string;
}): Promise<DataLoadRow> {
  const { rows } = await getPool().query<DataLoadRow>(
    `insert into data_loads (
       company_id, uploaded_by_user_id, uploaded_by_email, source,
       files, status, failure_reason, finished_at
     ) values ($1, $2, $3, 'upload', $4, 'failed', $5, now())
     ${RETURNING}`,
    [
      input.companyId,
      input.userId,
      input.email,
      JSON.stringify(input.files),
      // Bounded: a parser error can carry a large fragment of the offending
      // file, and the audit trail is not the place to accidentally store it.
      input.reason.slice(0, 2000),
    ],
  );
  return rows[0]!;
}

export async function findLoads(companyId: number): Promise<DataLoadRow[]> {
  const { rows } = await getPool().query<DataLoadRow>(
    `select id, company_id, uploaded_by_user_id, uploaded_by_email, source,
            files, row_counts, issue_count, error_count, status, failure_reason,
            started_at, finished_at
     from data_loads
     where company_id = $1
     order by started_at desc
     limit 20`,
    [companyId],
  );
  return rows;
}
