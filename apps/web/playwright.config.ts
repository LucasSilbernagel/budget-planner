import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { PROD_E2E_SESSION_SECRET } from './e2e/helpers/prod-session'

/**
 * Playwright E2E configuration for @budget-planner/web.
 *
 * Browser binaries are NOT installed by `pnpm install`. Before the first run:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 *
 * By default Playwright boots the Vite dev server (port 5173). Point it at an
 * already-running instance with PLAYWRIGHT_BASE_URL to skip that.
 *
 * ## Two servers, because tier is a SERVER-side fact (story 58.1, D2)
 *
 * Story 58.1 made `GlobalNav` tier-aware, and the tier comes from the SSR session
 * seed — so a paid nav cannot be produced from the browser side at all. The
 * `getSessionSeed` dev-only seam (`server/api/auth/session-seed.ts`, guarded by
 * AC-9) reads `E2E_SESSION_SEED` from the SERVER's environment, which means the
 * choice is made when the server boots, not per test.
 *
 * ⚠️ That is exactly why the variable is NOT set on the default server. Setting it
 * globally would hand every existing spec a paid session, and the free-tier guards
 * — `chrome-320.spec.ts`'s `BAR_LABELS`/`SHEET_LABELS`, `nav-planner-visibility`'s
 * row counts, `premium-locked.spec.ts`'s entire premise — would quietly start
 * asserting against a nav they were never written for. Several would still PASS,
 * which is the dangerous part.
 *
 * So there are two servers and two projects:
 *
 *   - `chromium`      :5173, no override  → the FREE nav. Every pre-existing spec,
 *                                            unchanged, still measuring what it
 *                                            always measured.
 *   - `chromium-paid` :5174, paid seed    → the PAID nav. Only `*.paid.spec.ts`.
 *
 * A paid spec that is not named `*.paid.spec.ts` runs on the free server and
 * measures the free nav. If a paid-tier assertion mysteriously passes against 7
 * anchors, check the filename first.
 *
 * ⚠️ With `PLAYWRIGHT_BASE_URL` set, the `chromium-paid` project is DROPPED, not
 * pointed elsewhere. The seam is compiled out of a production build, so the paid
 * nav cannot be rendered against an external server at all.
 *
 * ## A third server: the PRODUCTION build (story 83.1)
 *
 *   - `chromium-prod` :5175, `pnpm build && node server-entry.mjs`, NO database
 *                                          → only `*.prod.spec.ts`.
 *
 * Some defects exist only in the production CLIENT bundle. Story 80.1 Fact R was
 * one: the forecasting page `import()`ed server code in the browser, the prod
 * chunk carried `pg` and failed with `Buffer is not defined`, and the dev server
 * (where Vite serves modules differently) could not show it truthfully. So this
 * project builds first and serves the real `dist/`. See
 * `e2e/forecasting-roundtrip.prod.spec.ts` for what is real and what is stubbed.
 *
 * ## Layout tests are their own projects (story 82.3, FR135, D2)
 *
 * A test whose claim needs a real layout engine (boxes, overflow, wrapping,
 * computed style, paint, print, viewport-bound composition) carries
 * `{ tag: '@layout' }`. `chromium` / `chromium-paid` exclude those tests and
 * `chromium-layout` / `chromium-paid-layout` run only them, on the SAME servers.
 * `chromium-prod` excludes them too and has no layout twin: a prod-bundle test
 * is a flow test by construction, so a `@layout` tag in a `*.prod.spec.ts`
 * would run NOWHERE. `gates-lib.test.ts` pins that no prod spec carries one.
 * Every other test is in exactly one of the two halves, because `grep` and
 * `grepInvert` use the same pattern.
 *
 * A plain `playwright test` (CI's `pnpm test:e2e`) runs every project, so CI
 * blocks a merge and a deploy on layout. `pnpm gates` runs the layout projects
 * only with `--layout` (see `project-context.md` for when a story must).
 * An untagged layout test is not lost: it runs in the default half, every time.
 *
 * ## Screenshots are their own projects too (story 84.1, FR137)
 *
 *   - `screenshots`       :5173 (free) → only `*.screenshot.spec.ts`
 *   - `screenshots-paid`  :5174 (paid) → only `*.screenshot.paid.spec.ts`
 *
 * Selected by FILENAME, and every other project `testIgnore`s `SCREENSHOT_SPEC`,
 * so a screenshot spec runs in exactly one project. (`*.screenshot.paid.spec.ts`
 * also ends in `.paid.spec.ts`, which is why the paid projects need the ignore.)
 * CI's plain `playwright test` runs them and blocks the deploy; `pnpm gates`
 * never does (`E2E_SCREENSHOT_PROJECTS` in `gates-lib.mjs`), because the
 * baselines in `e2e/__screenshots__/` are rendered in CI (DejaVu Sans) and a
 * dev box renders `system-ui` as Noto Sans. `SCREENSHOT_DIR` points the
 * snapshots at a scratch directory, for a local run against local baselines
 * (story 84.1's mutation proof); never commit what it writes.
 */
const LAYOUT_TAG = /@layout\b/

/** The screenshot specs (story 84.1): ONLY the two screenshot projects run them. */
const SCREENSHOT_SPEC = /\.screenshot(\.paid)?\.spec\.ts$/

const externalBaseURL = process.env['PLAYWRIGHT_BASE_URL']
const baseURL = externalBaseURL || 'http://localhost:5173'

/**
 * The entitled session the paid project's server is booted with.
 *
 * `active` (not `lifetime`) deliberately: it is the status the majority of paying
 * users carry, and `usePremiumAccess` treats the two identically, so the unit
 * suite is the right place to prove `lifetime` is also entitled.
 */
const PAID_SESSION_SEED = JSON.stringify({
  isAuthenticated: true,
  userId: 'e2e-paid-user',
  email: 'e2e-paid@example.test',
  subscriptionStatus: 'active',
})

const PAID_PORT = 5174
const paidBaseURL = `http://localhost:${PAID_PORT}`

/**
 * Shared by both dev servers so the two entries cannot drift apart.
 *
 * ⚠️ `env` MUST be passed for BOTH servers, including the free one. Playwright
 * merges rather than replaces — `{...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env,
 * ...options.env}` (playwright `lib/runner/index.js`) — so the ambient shell
 * environment reaches every dev server it launches. A developer who exported
 * `E2E_SESSION_SEED` while debugging would otherwise hand the FREE server an
 * entitled session too, and the free-tier guards (`chrome-320.spec.ts`,
 * `nav-planner-visibility.spec.ts`) would quietly start asserting against a nav
 * they were never written for. Passing an empty string is what closes that:
 * the seam tests `process.env['E2E_SESSION_SEED']` for truthiness, so `''` is
 * inert. (An earlier revision of this file spread `process.env` in by hand and
 * claimed it was required to preserve PATH/HOME — that was wrong on both counts,
 * and code review caught it.)
 */
const devServer = (port: number, sessionSeed: string) => ({
  // `--strictPort` so a busy port FAILS instead of silently sliding to the next
  // one — a paid server that quietly booted on 5175 would leave every paid spec
  // hitting the free server on 5174's fallback and passing against 7 anchors.
  command: `pnpm dev --port ${port} --strictPort`,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env['CI'],
  timeout: 120_000,
  env: { E2E_SESSION_SEED: sessionSeed },
})

const PROD_PORT = 5175
const prodBaseURL = `http://127.0.0.1:${PROD_PORT}`

/**
 * The production-build server for `chromium-prod` (story 83.1).
 *
 * ⚠️⚠️ `DATABASE_URL: ''` is a SAFETY requirement, not tidiness. Playwright MERGES
 * the ambient environment into the server's (see `devServer`), so a shell with
 * `DATABASE_URL` exported would point this server at a real database. Empty,
 * `getPool()` throws on first use (`packages/db/src/client.ts`), which is also what
 * makes the signed e2e cookie resolve to a NULL session seed
 * (`e2e/helpers/prod-session.ts`).
 *
 * ⚠️ `reuseExistingServer: false`, unlike the dev servers: a server left running
 * from an earlier build would serve an OLD bundle, and this project exists to
 * test the bundle. The build runs every time (~10 s of vite, story 83.1 M1).
 */
const prodServer = {
  command: 'pnpm build && node server-entry.mjs',
  url: `${prodBaseURL}/api/health`,
  reuseExistingServer: false,
  timeout: 180_000,
  env: {
    NODE_ENV: 'production',
    PORT: String(PROD_PORT),
    HOST: '127.0.0.1',
    SITE_URL: prodBaseURL,
    SESSION_SECRET: PROD_E2E_SESSION_SECRET,
    DATABASE_URL: '',
    E2E_SESSION_SEED: '',
  },
}

// Resolved against the shell's cwd: Playwright resolves a relative template
// against THIS file's directory, which would drop scratch PNGs inside apps/web.
// A first run into an empty directory FAILS with "writing actual" by design;
// the second run compares (story 84.1 review).
const screenshotDir = process.env['SCREENSHOT_DIR']
  ? resolve(process.cwd(), process.env['SCREENSHOT_DIR'])
  : undefined

export default defineConfig({
  testDir: './e2e',
  // One render environment (CI), so no `{platform}` or `{projectName}` in the
  // path: the shot names are unique and explicit (`overview-320-dark.png`).
  snapshotPathTemplate: screenshotDir
    ? `${screenshotDir}/{testFilePath}/{arg}{ext}`
    : '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
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
      // Excluded, not merely unlisted: without this the paid specs would ALSO run
      // here, against the free server, and their paid assertions would fail for a
      // reason that looks nothing like "wrong server".
      testIgnore: [/\.paid\.spec\.ts$/, /\.prod\.spec\.ts$/, SCREENSHOT_SPEC],
      grepInvert: LAYOUT_TAG,
      use: { ...devices['Desktop Chrome'] },
    },
    // Story 82.3 (D2): the same free server, only the `@layout` tests.
    {
      name: 'chromium-layout',
      testIgnore: [/\.paid\.spec\.ts$/, /\.prod\.spec\.ts$/, SCREENSHOT_SPEC],
      grep: LAYOUT_TAG,
      use: { ...devices['Desktop Chrome'] },
    },
    // Story 84.1 (FR137): the same free server, only `*.screenshot.spec.ts`.
    {
      name: 'screenshots',
      testMatch: /\.screenshot\.spec\.ts$/,
      // No retry (story 84.1 review, Lucas): a shot that passes only on retry
      // is a real flake (CI run 36784606423 was a blank-chart race) and must
      // turn the run red, not hide as "flaky".
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
    },
    // ⚠️ Dropped entirely when PLAYWRIGHT_BASE_URL is set. That escape hatch points
    // the suite at an already-running (often production-built) server, and this
    // project cannot work there twice over: its two hard-coded ports have nothing
    // listening, and the seam it depends on is COMPILED OUT of a production build
    // by design (AC-9). Running it anyway would fail 12 tests with connection
    // errors that say nothing about the code. Skipping is the honest behaviour —
    // the paid nav simply is not measurable in that mode.
    ...(externalBaseURL
      ? []
      : [
          {
            name: 'chromium-paid',
            testMatch: /\.paid\.spec\.ts$/,
            testIgnore: SCREENSHOT_SPEC,
            grepInvert: LAYOUT_TAG,
            use: { ...devices['Desktop Chrome'], baseURL: paidBaseURL },
          },
          {
            name: 'chromium-paid-layout',
            testMatch: /\.paid\.spec\.ts$/,
            testIgnore: SCREENSHOT_SPEC,
            grep: LAYOUT_TAG,
            use: { ...devices['Desktop Chrome'], baseURL: paidBaseURL },
          },
          // Story 84.1: the paid server, only `*.screenshot.paid.spec.ts`.
          {
            name: 'screenshots-paid',
            testMatch: /\.screenshot\.paid\.spec\.ts$/,
            retries: 0,
            use: { ...devices['Desktop Chrome'], baseURL: paidBaseURL },
          },
          // Dropped with PLAYWRIGHT_BASE_URL too: it needs its own server, with
          // its own session secret, which an external server does not share.
          {
            name: 'chromium-prod',
            testMatch: /\.prod\.spec\.ts$/,
            grepInvert: LAYOUT_TAG,
            use: { ...devices['Desktop Chrome'], baseURL: prodBaseURL },
          },
        ]),
  ],
  // Auto-start the dev servers unless an external base URL was provided.
  webServer: externalBaseURL
    ? undefined
    : [
        // The free server is explicitly handed an EMPTY seed — see `devServer`.
        devServer(5173, ''),
        devServer(PAID_PORT, PAID_SESSION_SEED),
        prodServer,
      ],
})
