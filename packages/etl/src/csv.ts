import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/**
 * CSV reading.
 *
 * Uses `csv-parse` rather than a hand-rolled splitter: quoted fields containing
 * commas are everywhere in this data (`"$182,946.64"`, incident descriptions),
 * and a parser is not the interesting part of this project.
 *
 * Two things this layer adds on top.
 *
 * **Header trimming.** `fuel_deliveries.csv` ships headers as `Invoice No`,
 * ` Delivery Date`, `Fuel Type `, ` Unit` — inconsistent padding that would make
 * every column lookup a guessing game. Headers are trimmed, and the originals
 * are kept so the loader can report the padding as a (cosmetic) finding.
 *
 * **Physical line numbers.** Every data-quality issue points at the line a
 * reviewer can actually open in the file, so `source_row_number` is the line
 * number, not an array index.
 */

export type CsvRow = {
  /** 1-based line number in the source file. The header is line 1. */
  lineNumber: number;
  /** Field by trimmed header name; `''` when the column is absent. */
  value: (column: string) => string;
  record: Record<string, string>;
};

export type CsvFile = {
  headers: string[];
  rawHeaders: string[];
  /** True when at least one header carried leading or trailing whitespace. */
  hasUntrimmedHeaders: boolean;
  rows: CsvRow[];
};

/**
 * Parse CSV text.
 *
 * Split out from `readCsv` when uploads arrived: a file posted to the API is a
 * buffer in memory, and the alternative was writing it to a temp path purely so
 * the parser could read it back. `label` is only ever used in error messages —
 * a filesystem path from the CLI, an uploaded filename from the API — so the
 * error still names something the reader can go and open.
 */
export function parseCsv(text: string, label: string): CsvFile {
  const firstLine = text.split('\n', 1)[0] ?? '';
  const rawHeaders = parse(firstLine, { columns: false })[0] as string[];
  const headers = rawHeaders.map((h) => h.trim());

  const records = parse(text, {
    // An array, not a function. Given a function, csv-parse consumes the first
    // line it reads as the header — which, combined with `from_line: 2`, eats
    // the first data row of every file. Passing the names directly means no
    // line is treated as a header and `from_line` means what it says.
    columns: headers,
    from_line: 2,
    skip_empty_lines: true,
    // Loud, not lenient: a ragged row means the file is not what we think it
    // is, and guessing which column shifted would corrupt the load silently.
    relax_column_count: false,
  }) as Record<string, string>[];

  // Line numbering below assumes one record per physical line. That holds for
  // this export and is checked rather than trusted: a quoted field containing a
  // newline would silently offset every issue we report by one row from there
  // on, which is worse than failing here.
  const nonEmptyLines = text
    .split('\n')
    .filter((line) => line.trim() !== '').length;
  if (records.length !== nonEmptyLines - 1) {
    throw new Error(
      `${label}: parsed ${records.length} records from ${nonEmptyLines - 1} data lines. ` +
        'A field probably contains a newline, which would make reported line numbers wrong.',
    );
  }

  return {
    headers,
    rawHeaders,
    hasUntrimmedHeaders: rawHeaders.some((h) => h !== h.trim()),
    rows: records.map((record, index) => ({
      lineNumber: index + 2,
      value: (column: string) => record[column] ?? '',
      record,
    })),
  };
}

/** Read and parse a CSV from disk. The CLI path; the API uses `parseCsv`. */
export function readCsv(path: string): CsvFile {
  return parseCsv(readFileSync(path, 'utf8'), path);
}
