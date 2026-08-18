import type { FastifyInstance } from 'fastify';

export function registerNotFoundHandler(app: FastifyInstance): void {
  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({
      error: 'not_found',
      message: `No route for ${request.method} ${request.url}`,
      hint: 'See /docs for the available endpoints.',
    }),
  );
}
