import { withClient } from '@ironbark/db';
import {
  ingestWithClient,
  INGEST_FILES,
  MissingFileError,
  type IngestFileName,
  type IngestInput,
} from '@ironbark/etl';
import { AppError } from '../errors.js';
import * as repository from '../repositories/uploads.repository.js';
import { camelCaseRows } from '../utils/case.js';

/**
 * Dataset replacement: the same pipeline `npm run etl` runs, driven by a
 * multipart request instead of a directory, so a cleaning rule cannot apply on
 * the command line and quietly not apply on upload.
 *
 * Semantics are replace, not merge. An upload deletes the company's rows and
 * reloads from the files provided, in one transaction, which is why all five
 * files are required.
 */

export class UploadError extends AppError {
  constructor(message: string, hint?: string) {
    super(422, 'upload_failed', message, hint);
  }
}

export type UploadedFile = {
  /** Which of the five canonical files this plays the role of. */
  role: IngestFileName;
  /** The name as it arrived, for the audit row. */
  filename: string;
  text: string;
};

export type UploadActor = { userId: number; email: string };

/**
 * Ingest, and record the attempt either way.
 *
 * A failed upload writes a `data_loads` row too, outside the rolled-back
 * transaction. Without that, the most interesting event in the system, someone
 * tried to load a file and the pipeline refused it, would leave no trace at
 * all, and the user's report of "it didn't work" would be unanswerable.
 */
export async function replaceDataset(
  companyId: number,
  actor: UploadActor,
  files: UploadedFile[],
): Promise<{
  load: ReturnType<typeof toLoadSummary>;
  issuesByRule: [string, number][];
  ai: unknown;
}> {
  const input: IngestInput = {};
  for (const file of files) input[file.role] = file.text;

  const fileManifest = files.map((file) => ({
    role: file.role,
    name: file.filename,
    bytes: Buffer.byteLength(file.text, 'utf8'),
  }));

  try {
    const result = await withClient(async (client) => {
      await client.query('begin');
      try {
        const ingested = await ingestWithClient(client, companyId, input);
        const load = await repository.recordLoad(client, {
          companyId,
          userId: actor.userId,
          email: actor.email,
          files: fileManifest,
          rowCounts: ingested.rowCounts,
          issueCount: ingested.issueCount,
          errorCount: ingested.errorCount,
        });
        await client.query('commit');
        return { ingested, load };
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    });

    return {
      load: toLoadSummary(result.load),
      issuesByRule: result.ingested.issuesByRule,
      ai: result.ingested.ai,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    await repository
      .recordFailedLoad({
        companyId,
        userId: actor.userId,
        email: actor.email,
        files: fileManifest,
        reason,
      })
      // The audit write must not replace the real error with its own. If it
      // fails, the caller still needs to hear why the *upload* failed.
      .catch(() => undefined);

    if (error instanceof MissingFileError) {
      throw new UploadError(error.message, `Expected: ${INGEST_FILES.join(', ')}.`);
    }

    // Everything reaching here is a rejection by the pipeline or the schema, 
    // a ragged CSV, a missing column, a constraint the cleaned data violated.
    // The message names the file and line, which is exactly what the person
    // holding the file needs, so it is passed through rather than generalised.
    throw new UploadError(
      reason,
      'Nothing was changed — the load runs in one transaction, so your previous dataset is intact.',
    );
  }
}

function toLoadSummary(row: repository.DataLoadRow) {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    files: row.files,
    rowCounts: row.row_counts,
    issueCount: row.issue_count,
    errorCount: row.error_count,
    uploadedByEmail: row.uploaded_by_email,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    failureReason: row.failure_reason,
  };
}

export async function listLoads(companyId: number) {
  const rows = await repository.findLoads(companyId);
  return { loads: camelCaseRows(rows) };
}
