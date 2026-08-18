/**
 * Shared JSON Schema fragments.
 *
 * Fastify validates with these and @fastify/swagger derives the OpenAPI
 * document from the same objects, so the docs cannot drift from what the
 * server actually accepts.
 */

const MONTH_PATTERN = '^\\d{4}-\\d{2}$';

export const monthParam = {
  type: 'string',
  pattern: MONTH_PATTERN,
  description: 'Month as YYYY-MM',
} as const;

export const errorResponse = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    message: { type: 'string' },
    hint: { type: 'string' },
  },
} as const;
