import type { FastifyInstance } from 'fastify';

/**
 * Adds `x-response-time` and warns on slow requests.
 *
 * Modest, but it is the thing that tells you a dashboard feels sluggish because
 * of one unindexed query rather than the network, and it costs one hook.
 */
const SLOW_REQUEST_MS = 500;

export function registerRequestTiming(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    request.startTime = process.hrtime.bigint();
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.startTime !== undefined) {
      const elapsedMs =
        Number(process.hrtime.bigint() - request.startTime) / 1_000_000;
      reply.header('x-response-time', `${elapsedMs.toFixed(1)}ms`);

      if (elapsedMs > SLOW_REQUEST_MS) {
        request.log.warn(
          { url: request.url, elapsedMs },
          'slow request',
        );
      }
    }
    return payload;
  });
}

declare module 'fastify' {
  interface FastifyRequest {
    startTime?: bigint;
  }
}
