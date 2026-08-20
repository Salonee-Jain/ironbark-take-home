/**
 * Shared JSON Schema fragments.
 *
 * Fastify validates with these and @fastify/swagger derives the OpenAPI
 * document from the same objects, so the docs cannot drift from what the
 * server actually accepts.
 */

/**
 * The month component is range-checked, not merely counted.
 *
 * `\d{2}` accepts `2026-13`, which then reaches Postgres and fails casting to a
 * date — a 500 on what is plainly a bad request. Validation is the layer that
 * should say so, and it should say so in the OpenAPI document too, which is
 * generated from this same object.
 */
const MONTH_PATTERN = '^\\d{4}-(0[1-9]|1[0-2])$';

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
