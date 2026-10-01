import { defineConfig, devices } from '@playwright/test'

/**
 * Manual performance measurements (story 84.5, D3, Lucas 2026-10-01).
 *
 * NOT part of any gate or CI run: `playwright test` loads `playwright.config.ts`,
 * whose `testDir` is `./e2e`, so nothing in `./perf` is ever listed there. Run a
 * file here only on purpose, against a PRODUCTION build you started yourself
 * (recipe in each spec's header). No `webServer`: a timing taken against a Vite
 * dev server is a number about Vite, not about the app.
 */
// ⚠️ NOT thrown here (84.5 code review): tooling that loads every
// `playwright*.config.ts` (the VS Code extension, a config walker) would crash at
// import. Each perf spec checks `PLAYWRIGHT_BASE_URL` itself, before measuring.
const baseURL = process.env['PLAYWRIGHT_BASE_URL']

export default defineConfig({
  testDir: './perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    // The measurement asserts this exact viewport (NFR9 AC-2: name it).
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'perf', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
  ],
})
