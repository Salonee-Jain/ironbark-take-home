import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Scaffold only for now; the suites arrive with the normalisers in step 3.
    passWithNoTests: true,
  },
});
