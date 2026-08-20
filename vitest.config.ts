import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // The suites exist now, so an empty run means they failed to be collected —
    // which should fail CI rather than pass quietly.
    passWithNoTests: false,
  },
});
