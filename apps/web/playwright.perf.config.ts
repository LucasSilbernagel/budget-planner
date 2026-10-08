import { defineConfig, devices } from '@playwright/test'

// Never in a gate or CI: the default config's testDir is ./e2e. No webServer: a timing
// taken against the Vite dev server is about Vite, not the app.

// Not thrown here: tooling that loads every playwright*.config.ts would crash at
// import. Each perf spec checks it before measuring.
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
    // The measurement asserts this exact viewport.
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'perf', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
  ],
})
