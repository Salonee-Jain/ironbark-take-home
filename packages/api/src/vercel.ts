import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServer } from './server.js';

/**
 * The API as a Vercel function.
 *
 * A catch-all under /api rather than a single file plus rewrites: a rewrite
 * changes which file handles the request, and the exact path Fastify then sees
 * is a detail of the platform rather than something this repo controls. A
 * catch-all route matches /api/anything natively, so the URL the router matches
 * on is the URL the client asked for.
 *
 * The app is built once per instance and reused. Building it opens no sockets
 * and touches no database, so it is cheap on a cold start; the connection pool
 * is created lazily by the first query and then shared by every request that
 * lands on the same instance.
 */
const app = buildServer({ logger: true });
const ready = app.ready();

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await ready;
  app.server.emit('request', request, response);
}
