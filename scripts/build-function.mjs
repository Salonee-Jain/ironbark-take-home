/**
 * Bundles the API into a single file for deployment.
 *
 *   npm run build:function
 *
 * The hosted build compiles the function's own TypeScript but ships workspace
 * dependencies as raw .ts, which Node cannot import at runtime. Bundling
 * resolves every workspace import at build time instead, so what gets deployed
 * has no unresolved imports left in it.
 *
 * The output is deliberately not committed: it is a build artefact, and the
 * only source of truth for the API is packages/api/src.
 */
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['packages/api/src/vercel.ts'],
  outfile: 'api/_bundle.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Optional native accelerator for pg. Absent here, and pg falls back to its
  // JavaScript implementation, so bundling it would fail for no benefit.
  external: ['pg-native'],
  // The output is ESM but several dependencies are CommonJS and call require()
  // at load time. Without this shim the bundle throws "Dynamic require of
  // node:crypto is not supported" before the first request.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`api/_bundle.js  ${(bytes / 1024 / 1024).toFixed(1)}mb`);
