import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const __dirname = dirname(fileURLToPath(import.meta.url))

const { version: appVersion } = JSON.parse(
  readFileSync(resolve(__dirname, './package.json'), 'utf-8')
) as { version: string }

// Default `node` so server-only modules (the db package throws when `window` exists) import.
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    // The explicit `/src` db rule must precede the bare db rule, or it rewrites to `db/src/src`.
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
      {
        find: 'virtual:pwa-register',
        replacement: resolve(__dirname, './src/test/pwa-register-mock.ts'),
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
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    // pg.Pool connects lazily, so this dummy URL opens no connection.
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/budget_planner_test',
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef-fixed',
      EMAIL_API_KEY: 'test-email-api-key',
      EMAIL_FROM: 'no-reply@budgetplanner.test',
      SITE_URL: 'https://app.test',
      // PGlite's session TimeZone follows the host; UTC matches CI and production, else
      // `timestamp without time zone` defaults store local wall time.
      TZ: 'UTC',
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
