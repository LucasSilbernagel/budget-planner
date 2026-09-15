import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration for @budget-planner/web.
 *
 * Browser binaries are NOT installed by `pnpm install`. Before the first run:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 *
 * By default Playwright boots the Vite dev server (port 5173). Point it at an
 * already-running instance with PLAYWRIGHT_BASE_URL to skip that.
 */
const baseURL = process.env['PLAYWRIGHT_BASE_URL'] || 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  // One retry, not two: a genuinely broken test otherwise runs three times
  // before CI reports it.
  retries: process.env['CI'] ? 1 : 0,
  // GitHub-hosted runners have 4 vCPUs. The suite is safe to parallelise: every
  // test gets its own browser context (so its own localStorage), the server
  // side is only ever read, and the few order-dependent files opt into serial
  // mode with `test.describe.configure`. At 1 worker the suite took ~7.5 min.
  workers: process.env['CI'] ? 4 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Auto-start the dev server unless an external base URL was provided.
  webServer: process.env['PLAYWRIGHT_BASE_URL']
    ? undefined
    : {
        command: 'pnpm dev',
        url: baseURL,
        reuseExistingServer: !process.env['CI'],
        timeout: 120_000,
      },
})
