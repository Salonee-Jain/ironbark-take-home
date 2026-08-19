import type { FastifyInstance, FastifyRequest } from 'fastify';
import { INGEST_FILES, type IngestFileName } from '@ironbark/etl';
import { companyIdOf } from '../middlewares/authenticate.js';
import { errorResponse } from '../schemas/common.schema.js';
import * as service from '../services/uploads.service.js';
import { UploadError, type UploadedFile } from '../services/uploads.service.js';

/**
 * Dataset upload.
 *
 * The only write endpoint in the API, and the reason the request-handling this
 * codebase previously had no use for now exists: multipart parsing, a role for
 * each part, an owner-only guard, and an audit row. This is exactly the case
 * `server.ts` said would justify reintroducing real request handling — so it
 * lives here, in the route, rather than being smeared across the service.
 */

/**
 * Which part name maps to which of the five canonical files.
 *
 * Accepting the *field name* rather than sniffing the uploaded filename is
 * deliberate. A client's export is rarely named `fuel_deliveries.csv` — it is
 * `Fuel Deliveries FY26 (final) v3.csv` — and guessing a file's role from its
 * name is exactly the kind of silent inference that puts electricity readings
 * through the fuel loader. The form says what each file is; the server does not
 * guess.
 */
const FIELD_TO_ROLE: Record<string, IngestFileName> = {
  emissionFactors: 'emission_factors.csv',
  fuelDeliveries: 'fuel_deliveries.csv',
  electricityReadings: 'electricity_meter_readings.csv',
  incidentRegister: 'incident_register.csv',
  suppliers: 'suppliers.csv',
};

/**
 * A CSV that is not text is not a CSV.
 *
 * Checked because the alternative is handing a spreadsheet's binary bytes to
 * the parser and reporting a baffling "ragged row" error, when the real problem
 * is that someone attached the .xlsx.
 */
function assertLooksLikeText(filename: string, buffer: Buffer): void {
  // A NUL byte in the first kilobyte is the reliable tell for a binary
  // container — xlsx (a zip), a PDF, a database export.
  if (buffer.subarray(0, 1024).includes(0)) {
    throw new UploadError(
      `${filename} does not look like a CSV file.`,
      'Export the sheet as CSV (UTF-8) and upload that. Spreadsheet and PDF files cannot be parsed.',
    );
  }
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/uploads',
    {
      // Owner-only. An upload replaces everything the company has loaded, which
      // is not a thing a read-only viewer should be one misclick away from.
      onRequest: app.requireOwner,
      schema: {
        tags: ['uploads'],
        summary: 'Replace this company\'s dataset',
        description:
          'Multipart upload of the five source CSVs, each under its own field name: emissionFactors, ' +
          'fuelDeliveries, electricityReadings, incidentRegister, suppliers. Runs the same cleaning ' +
          'pipeline as `npm run etl` and returns the data-quality findings it raised.\n\n' +
          'Replaces rather than merges: the load deletes this company\'s existing rows and reloads ' +
          'from the files provided, in a single transaction. All five files are required, because a ' +
          'partial upload would delete the datasets it did not carry. If anything fails, nothing is ' +
          'changed and the attempt is still recorded in the load history.',
        consumes: ['multipart/form-data'],
        response: { 401: errorResponse, 403: errorResponse, 422: errorResponse },
      },
    },
    async (request: FastifyRequest, reply) => {
      const files: UploadedFile[] = [];
      const seen = new Set<IngestFileName>();

      for await (const part of request.parts()) {
        if (part.type !== 'file') continue;

        const role = FIELD_TO_ROLE[part.fieldname];
        if (!role) {
          // Drained rather than ignored: an unconsumed file part leaves the
          // multipart stream stalled and the request never completes.
          await part.toBuffer();
          throw new UploadError(
            `Unexpected file field "${part.fieldname}".`,
            `Expected one of: ${Object.keys(FIELD_TO_ROLE).join(', ')}.`,
          );
        }

        const buffer = await part.toBuffer();
        if (seen.has(role)) {
          throw new UploadError(
            `Two files were sent for ${role}.`,
            'Send exactly one file per field.',
          );
        }
        seen.add(role);

        assertLooksLikeText(part.filename, buffer);

        files.push({
          role,
          filename: part.filename,
          // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become
          // part of the first column's header name and break every lookup.
          text: buffer.toString('utf8').replace(/^﻿/, ''),
        });
      }

      const missing = INGEST_FILES.filter((name) => !seen.has(name));
      if (missing.length > 0) {
        throw new UploadError(
          `Missing file(s): ${missing.join(', ')}.`,
          'An upload replaces the whole dataset, so all five files are required — otherwise the ones ' +
            'left out would be deleted rather than kept.',
        );
      }

      const result = await service.replaceDataset(
        companyIdOf(request),
        {
          userId: Number(request.session!.sub),
          email: request.session!.email,
        },
        files,
      );

      return reply.code(201).send(result);
    },
  );

  app.get(
    '/api/uploads',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['uploads'],
        summary: 'Load history',
        description:
          'The last 20 loads for this company, successful and failed. Because an upload replaces the ' +
          'dataset, this is the only record that a previous one existed — including what it contained ' +
          'and who ran it.',
        response: { 401: errorResponse },
      },
    },
    (request) => service.listLoads(companyIdOf(request)),
  );
}
