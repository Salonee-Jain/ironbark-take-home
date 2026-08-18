import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../errors.js';

/**
 * The single place that decides what an error looks like on the wire.
 *
 * Centralised so the shape cannot drift between endpoints — a client that can
 * parse one error can parse all of them — and so an unexpected exception cannot
 * leak a stack trace or a SQL fragment to a caller.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  // Typed explicitly: Fastify hands the handler `unknown` under strict mode,
  // and the narrowing below is what makes it safe to touch.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Errors the application raised deliberately. Safe to show verbatim.
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      });
    }

    // Schema validation. Fastify's message names the offending field, which is
    // exactly what a caller needs, so it is passed through.
    if (error.validation) {
      return reply.code(400).send({
        error: 'validation_failed',
        message: error.message,
        hint: 'See /docs for the accepted parameters.',
      });
    }

    // Anything else is a bug. Logged in full, reported as a generic 500: the
    // detail of a database error is useful to us and to an attacker, and to
    // nobody else.
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(error.statusCode ?? 500).send({
      error: 'internal_error',
      message: 'The request could not be completed.',
    });
  });
}
