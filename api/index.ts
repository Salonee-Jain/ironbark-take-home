/**
 * The deployed entry point. Every /api/* path is rewritten here, and Fastify
 * routes on the URL the client asked for rather than on the file that served
 * it.
 *
 * It re-exports rather than importing the server directly, and that indirection
 * is load-bearing. The platform compiles this file's TypeScript but ships the
 * workspace packages as raw .ts, which Node cannot resolve at runtime, so a
 * direct import fails on the first request with a missing module. The build
 * step therefore bundles the whole API into `_bundle.js` first, and this file
 * points at it. The underscore keeps the bundle from being treated as a route
 * of its own.
 *
 * Run `npm run build:function` to produce it; `npm run api` does not need it.
 */
export { default } from './_bundle.js';
