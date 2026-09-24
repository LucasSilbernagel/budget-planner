import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The package is `"type": "module"`, so `__dirname` is not defined here. Derive
// it the same way `apps/web/vitest.config.ts` does rather than relying on how
// vitest happens to load this file.
const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    // Resolve `@budget-planner/db` to its TypeScript SOURCE, never its compiled
    // output. The package's `main` points at `dist/index.js`, which is
    // gitignored (`packages/db/.gitignore`) and is NOT built by the CI unit-test
    // job — so a bare `@budget-planner/db` import resolves on a dev box (where a
    // stale `dist/` happens to exist) and fails in CI with "Failed to resolve
    // entry for package". That is exactly how `entity-schemas.test.ts` (the
    // SYNC_CURRENCIES parity test, story 66.2) shipped green and went red on the
    // first CI run after the merge.
    //
    // `apps/web/vitest.config.ts` already carries the same aliases; the rule
    // ordering here mirrors it — the explicit `/src` rule must precede the bare
    // rule, or a `@budget-planner/db/src/schema` import would be rewritten into
    // a doubled `.../db/src/src/schema`.
    alias: [
      {
        find: /^@budget-planner\/db\/src/,
        replacement: resolve(__dirname, '../db/src'),
      },
      {
        find: /^@budget-planner\/db/,
        replacement: resolve(__dirname, '../db/src'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
    },
  },
})
