import { z } from 'zod';

/**
 * The shape the model must return for a compliance summary.
 *
 * A flat list of claims rather than paragraphs, which is the load-bearing
 * decision here. Prose cannot be verified: a paragraph mixing four real figures
 * and one invented one either ships whole or not at all. A claim is the unit a
 * citation attaches to, so one unsupported sentence costs one sentence.
 *
 * Sections are an enum so the report has the same skeleton every month. A
 * document nobody can diff is a document nobody can review.
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
