/**
 * Types for the generated bundle, which is a build artefact rather than source.
 * Declared here so the entry point type-checks in an editor before the bundle
 * has been built.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

declare const handler: (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export default handler;
