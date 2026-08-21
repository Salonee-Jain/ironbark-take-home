import { z } from 'zod';

/**
 * The shape the model must return for a compliance summary.
 *
 * A flat list of claims rather than paragraphs of prose, and that is the load-
 * bearing decision in this whole feature. Prose cannot be verified: a paragraph
 * mixing four figures and one invented one is a single blob that either ships
 * whole or not at all. A claim is the unit a citation can attach to and the
 * unit the gate can throw away on its own, so one unsupported sentence costs
 * one sentence rather than the report.
 *
 * Sections are an enum rather than free text so the report has the same
 * skeleton every month. A summary whose headings drift between runs cannot be
 * diffed, and a compliance document nobody can diff is a document nobody can
 * review.
 */

export const REPORT_SECTIONS = [
  'Headline',
  'Emissions',
  'Safety',
  'Data quality',
  'Watch list',
] as const;

export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const ClaimSchema = z.object({
  section: z.enum(REPORT_SECTIONS),

  text: z
    .string()
    .describe(
      'One or two sentences. Every figure in it must be copied from a cited fact.',
    ),

  citations: z
    .array(z.string())
    .describe(
      'Ids of the facts this claim rests on, copied exactly from the fact pack. Never empty.',
    ),
});

export const ReportResponseSchema = z.object({
  claims: z.array(ClaimSchema),
});

export type Claim = z.infer<typeof ClaimSchema>;
export type ReportResponse = z.infer<typeof ReportResponseSchema>;
