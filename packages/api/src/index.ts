/**
 * API entry point.
 *
 *   npm run api
 *
 * Serves monthly emissions by scope, incident trends, and the data-quality
 * report. Interactive documentation at /api/docs.
 */
import { closePool } from '@ironbark/db';
import { buildServer } from './server.js';

// 4000, not 3000: see .env.example. A dev server already on 3000 produces a
// confusing half-failure rather than a clean "port in use".
const port = Number(process.env['API_PORT'] ?? 4000);
const host = process.env['API_HOST'] ?? '127.0.0.1';

const app = buildServer({ logger: true });

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await closePool();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ port, host });
  app.log.info(`docs at http://${host}:${port}/api/docs`);
} catch (error) {
  app.log.error(error);
  await closePool();
  process.exitCode = 1;
}
