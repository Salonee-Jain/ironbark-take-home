import { z } from 'zod';

/**
 * The shape the model must return.
 *
 * Enforced through structured outputs rather than asked for in prose, so a
 * malformed response is impossible rather than merely unlikely. Everything the
 * pipeline depends on being present is required; nothing is optional.
 */

/**
 * Safety categories.
 *
 * Deliberately richer than the source register's seven codes, because the point
 * of this layer is to see what the codes hide. `Fall from height` and
 * `Caught in / crushed` exist because the register files both under codes that
 * understate them: a fall from a ladder is logged as SLP, alongside tripping on
 * a walkway.
 */
export const INCIDENT_CATEGORIES = [
  'Psychosocial hazard',
  'Vehicle & mobile equipment',
  'Plant & equipment failure',
  'Slip, trip & fall',
  'Fall from height',
  'Caught in / crushed',
  'Manual handling',
  'Dropped object',
  'Environmental release',
  'Dust & air quality',
  'Electrical & power',
  'Other',
] as const;

/**
 * Psychosocial hazard subtypes, following the categories used in Australian
 * WHS guidance (Safe Work Australia's psychosocial code of practice).
 */
export const PSYCHOSOCIAL_SUBTYPES = [
  'Bullying or harassment',
  'Aggression or violence',
  'Excessive workload or fatigue',
  'Low job control',
  'Poor support',
  'Role conflict or lack of role clarity',
  'Exposure to traumatic events',
  'Remote or isolated work',
  'Not applicable',
] as const;

export const FindingSchema = z.object({
  incident_id: z
    .string()
    .describe('The incident_id exactly as given in the input list.'),

  category: z.enum(INCIDENT_CATEGORIES),

  is_psychosocial: z
    .boolean()
    .describe(
      'True if the description indicates a psychosocial hazard, regardless of how the incident was coded.',
    ),

  psychosocial_subtype: z.enum(PSYCHOSOCIAL_SUBTYPES),

  severity_assessment: z
    .number()
    .int()
    .min(1)
    .max(3)
    .describe(
      'The severity the description warrants on the 1-3 scale, judged only from the text.',
    ),

  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('How confident you are in this classification, 0 to 1.'),

  evidence_quote: z
    .string()
    .describe(
      'A span copied character for character from this incident description, supporting the classification.',
    ),

  rationale: z
    .string()
    .describe('One or two sentences explaining the classification.'),
});

export const BatchResponseSchema = z.object({
  findings: z.array(FindingSchema),
});

export type Finding = z.infer<typeof FindingSchema>;
export type BatchResponse = z.infer<typeof BatchResponseSchema>;
