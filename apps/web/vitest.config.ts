import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Vitest config for @budget-planner/web.
//
// Default environment is `node` so that server-only modules (e.g.
// @budget-planner/db, which throws when `window` is defined) can be imported
// by server-function tests. Component tests opt into `jsdom` via
// `environmentMatchGlobs` (any *.tsx test, anything under a `components`
// folder, or a *.dom.test.ts file).
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve workspace packages to their TypeScript source (never the compiled
    // output) so tests run against the latest code. Array form + regex is used
    // so ordering is deterministic: the app mixes two deep-import conventions —
    // core deep imports omit `/src` (`@budget-planner/core/finance`) while db
    // deep imports include it (`@budget-planner/db/src/schema`). The explicit
    // `/src` db rule must precede the bare-package db rule, otherwise the bare
    // rule would rewrite `.../db/src/schema` into a doubled `.../db/src/src/...`.
    alias: [
      {
        find: /^@budget-planner\/core/,
        replacement: resolve(__dirname, '../../packages/core/src'),
      },
      {
        find: /^@budget-planner\/config/,
        replacement: resolve(__dirname, '../../packages/config/src'),
      },
      {
        find: /^@budget-planner\/db\/src/,
        replacement: resolve(__dirname, '../../packages/db/src'),
      },
      {
        find: /^@budget-planner\/db/,
        replacement: resolve(__dirname, '../../packages/db/src'),
      },
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['src/**/*.{tsx,jsx}', 'jsdom'],
      ['src/**/components/**', 'jsdom'],
      ['**/*.dom.test.{ts,tsx}', 'jsdom'],
    ],
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Playwright specs live in e2e/ and use @playwright/test, which is
    // incompatible with the Vitest runner.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    // Provide a dummy DATABASE_URL so the server-only db client's
    // import-time `getDb()` does not throw. pg.Pool connects lazily, so no
    // real database connection is opened during unit tests (NFR8).
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/budget_planner_test',
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/__tests__/**',
        'src/mocks/**',
        'src/test/**',
      ],
    },
  },
})
