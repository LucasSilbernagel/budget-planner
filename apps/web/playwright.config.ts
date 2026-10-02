import { resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import {
  DB_SERVER_PORT,
  E2E_DATABASE_URL,
  E2E_DB_PORT,
  FAKE_PADDLE,
  MAIL_OUTBOX,
  NO_OUTBOUND_PROXY,
  SEEDED_USER,
} from './e2e/helpers/db-harness'
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
 * — the free screenshots, and every free-tier flow — would quietly start
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
 * ## A fourth server, the only one with a DATABASE (story 87.1, F9)
 *
 *   - `chromium-db` :5176, `pnpm dev` + `DATABASE_URL` + the mail outbox
 *                                          → only `*.db.spec.ts`.
 *
 * A real sign-in touches the database at every step (rate limits, the user
 * lookup, the login token, the session). The database is a PGlite with the
 * real migration chain, served over the Postgres wire on :55432 by
 * `e2e/helpers/pglite-server.mjs`, which Playwright starts as its own
 * `webServer` (fresh every run, never reused) and stops with the run. Only
 * :5176 is handed its `DATABASE_URL`; every other server gets `''`. The
 * magic-link email lands in a dev-only outbox file (`E2E_MAIL_OUTBOX`, guarded
 * by `server/email/mailer-outbox-dev-seam.guard.test.ts` and the bundle check).
 *
 * Story 87.2 (F10, the upgrade) runs on the same server, which is also given
 * a complete, OBVIOUSLY FAKE Paddle configuration (`FAKE_PADDLE`: sandbox,
 * fake client token, fake price ids, a fake webhook secret the test signs
 * with) and no way out to the internet: its outbound HTTP(S) goes through a
 * proxy on a closed local port (`NO_OUTBOUND_PROXY`), so even a regression
 * that made the webhook call Paddle's customer API could not reach Paddle.
 * The browser half (Paddle.js) is stubbed by the spec (`helpers/paddle-stub.ts`).
 *
 * ## No layout-measurement projects (story 84.2, FR137)
 *
 * Story 82.3 split `{ tag: '@layout' }` tests into `chromium-layout` /
 * `chromium-paid-layout`. Story 84.2 deleted both projects and 285 of those 293
 * tests (8 behaviour tests were untagged into the default projects for 84.3 /
 * 84.5): the screenshot projects below are now the only layout-dedicated
 * projects (a few flow tests still assert rendered layout), and every
 * claim is listed as COVERED (by a named shot, with mutation proof), DROPPED,
 * DROPPED-pending-fix or HANDED-OFF in
 * `_bmad-output/implementation-artifacts/84-2-evidence/inventory.md`.
 * No project selects by tag any more, and `gates-lib.test.ts` fails on any
 * `tag:` in a spec.
 *
 * ## Screenshots are their own projects (story 84.1, FR137)
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
/** The screenshot specs (story 84.1): ONLY the two screenshot projects run them. */
const SCREENSHOT_SPEC = /\.screenshot(\.paid)?\.spec\.ts$/
/** The database specs (story 87.1): ONLY `chromium-db` runs them. */
const DB_SPEC = /\.db\.spec\.ts$/

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
 * Shared by every dev server so the entries cannot drift apart.
 *
 * ⚠️ `env` MUST be passed for BOTH servers, including the free one. Playwright
 * merges rather than replaces — `{...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env,
 * ...options.env}` (playwright `lib/runner/index.js`) — so the ambient shell
 * environment reaches every dev server it launches. A developer who exported
 * `E2E_SESSION_SEED` while debugging would otherwise hand the FREE server an
 * entitled session too, and the free-tier tests (the free flows and
 * screenshots) would quietly start asserting against a nav
 * they were never written for. Passing an empty string is what closes that:
 * the seam tests `process.env['E2E_SESSION_SEED']` for truthiness, so `''` is
 * inert. (An earlier revision of this file spread `process.env` in by hand and
 * claimed it was required to preserve PATH/HOME — that was wrong on both counts,
 * and code review caught it.)
 */
const devServer = (port: number, env: DevServerEnv) => ({
  // `--strictPort` so a busy port FAILS instead of silently sliding to the next
  // one — a paid server that quietly booted on 5175 would leave every paid spec
  // hitting the free server on 5174's fallback and passing against 7 anchors.
  //
  // Run through `dev-server-dep-guard.mjs` (story 85.2): it still runs exactly
  // `pnpm dev --port <port> --strictPort`, and also records any mid-run dependency
  // re-optimization, which reloads every open page. `globalTeardown` fails the
  // run on one.
  command: `node e2e/helpers/dev-server-dep-guard.mjs ${port}`,
  url: `http://localhost:${port}`,
  // The database server (:5176) is NEVER reused, like its PGlite (`dbServer`):
  // a stray :5176 (another worktree, a hand-run `pnpm dev`) carries whatever
  // DATABASE_URL / outbox / SITE_URL it was started with, and F9 would fail
  // for a reason that says nothing about sign-in (87.1 review).
  reuseExistingServer: env.databaseUrl ? false : !process.env['CI'],
  timeout: 120_000,
  // Every variable a dev server's behaviour hangs on is passed EXPLICITLY, for
  // the merge reason above: an ambient `DATABASE_URL` must not reach :5173 or
  // :5174 (story 87.1), and an ambient `EMAIL_API_KEY` would make the mailer
  // call Brevo from a test instead of taking its development branch.
  env: {
    E2E_SESSION_SEED: env.sessionSeed,
    DATABASE_URL: env.databaseUrl ?? '',
    E2E_MAIL_OUTBOX: env.mailOutbox ?? '',
    EMAIL_API_KEY: '',
    ...(env.siteUrl ? { SITE_URL: env.siteUrl } : {}),
    ...env.extra,
  },
})

interface DevServerEnv {
  sessionSeed: string
  databaseUrl?: string
  mailOutbox?: string
  /** The origin the magic-link email's link is built from (`getSiteUrl`). */
  siteUrl?: string
  /** Any further variables, set explicitly (story 87.2: Paddle, the proxy). */
  extra?: Record<string, string>
}

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
    // Story 87.1: no test may reach Brevo, whatever the shell exports, and no
    // ambient outbox path (the production build drops that branch anyway).
    EMAIL_API_KEY: '',
    E2E_MAIL_OUTBOX: '',
  },
}

// Resolved against the shell's cwd: Playwright resolves a relative template
// against THIS file's directory, which would drop scratch PNGs inside apps/web.
// A first run into an empty directory FAILS with "writing actual" by design;
// the second run compares (story 84.1 review).
const screenshotDir = process.env['SCREENSHOT_DIR']
  ? resolve(process.cwd(), process.env['SCREENSHOT_DIR'])
  : undefined

// The teardown below ignores dep-reload logs older than this run (a reused local
// server never goes through the wrapper). Always this load's own time, never an
// inherited value: a stale or empty one would count old logs (85.2 review P9).
// Only the main process's value matters (it runs the teardown).
process.env['E2E_RUN_STARTED_AT'] = String(Date.now())

const dbBaseURL = `http://localhost:${DB_SERVER_PORT}`

// The dev servers below, by port. The teardown checks exactly these (via the
// env), so it can't drift from what is started (85.2 review P10).
const DEV_SERVERS: ReadonlyArray<readonly [number, DevServerEnv]> = [
  // The free server is explicitly handed an EMPTY seed — see `devServer`.
  [5173, { sessionSeed: '' }],
  [PAID_PORT, { sessionSeed: PAID_SESSION_SEED }],
  // Story 87.1: no seed (F9 signs in for real), the PGlite database, the
  // outbox, and links that point back at THIS server, not :5173.
  [
    DB_SERVER_PORT,
    {
      sessionSeed: '',
      databaseUrl: E2E_DATABASE_URL,
      mailOutbox: MAIL_OUTBOX,
      siteUrl: dbBaseURL,
      // Story 87.2 (F10): EVERY Paddle variable, explicitly, so no ambient
      // (shell or `.env`) Paddle value can reach this server (merge, above).
      // All fakes; `PADDLE_ENVIRONMENT` is `sandbox` (AC 4).
      extra: {
        PADDLE_ENVIRONMENT: FAKE_PADDLE.environment,
        PADDLE_API_KEY: FAKE_PADDLE.apiKey,
        PADDLE_CLIENT_TOKEN: FAKE_PADDLE.clientToken,
        PADDLE_WEBHOOK_SECRET: FAKE_PADDLE.webhookSecret,
        PADDLE_WEBHOOK_MAX_AGE_SECONDS: '300',
        PADDLE_MONTHLY_PRICE_ID: FAKE_PADDLE.monthlyPriceId,
        PADDLE_ANNUAL_PRICE_ID: FAKE_PADDLE.annualPriceId,
        PADDLE_LIFETIME_PRICE_ID: FAKE_PADDLE.lifetimePriceId,
        // No request leaves this server for the internet (AC 4): Node (>= 24)
        // sends fetch/http through the proxy, which refuses. Loopback is
        // exempt (the database socket is plain TCP anyway).
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: NO_OUTBOUND_PROXY,
        HTTPS_PROXY: NO_OUTBOUND_PROXY,
        NO_PROXY: 'localhost,127.0.0.1,::1',
      },
    },
  ],
]

/**
 * The PGlite database for `chromium-db` (story 87.1, D1). Listed FIRST so it
 * is up before :5176 starts (Playwright starts the servers in order).
 * `reuseExistingServer: false`: every run gets a fresh, migrated, seeded
 * database, so no rate-limit bucket or token survives from an earlier run,
 * and a stray one on the port fails the start instead of being reused.
 */
const dbServer = {
  command: 'node e2e/helpers/pglite-server.mjs',
  port: E2E_DB_PORT,
  reuseExistingServer: false,
  timeout: 60_000,
  env: {
    E2E_DB_PORT: String(E2E_DB_PORT),
    E2E_DB_SEED_EMAIL: SEEDED_USER.email,
    E2E_DB_SEED_PADDLE_ID: SEEDED_USER.paddleId,
    E2E_MAIL_OUTBOX: MAIL_OUTBOX,
    // It reads neither; blanked so no ambient value is even present (merge).
    DATABASE_URL: '',
    EMAIL_API_KEY: '',
  },
}
process.env['E2E_DEV_SERVER_PORTS'] = externalBaseURL
  ? ''
  : DEV_SERVERS.map(([port]) => port).join(',')

export default defineConfig({
  testDir: './e2e',
  // Story 85.2: fails the run if a dev server re-optimized a dependency mid-run.
  globalTeardown: './e2e/global-teardown.ts',
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
      testIgnore: [/\.paid\.spec\.ts$/, /\.prod\.spec\.ts$/, DB_SPEC, SCREENSHOT_SPEC],
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
            use: { ...devices['Desktop Chrome'], baseURL: prodBaseURL },
          },
          // Story 87.1 (F9) and 87.2 (F10): the :5176 server, the only
          // one with a database. Dropped with PLAYWRIGHT_BASE_URL too: an
          // external server has neither the PGlite database nor the outbox.
          // Every other project selects by `testMatch` or ignores `DB_SPEC`.
          {
            name: 'chromium-db',
            testMatch: DB_SPEC,
            use: { ...devices['Desktop Chrome'], baseURL: dbBaseURL },
          },
        ]),
  ],
  // Auto-start the dev servers unless an external base URL was provided.
  webServer: externalBaseURL
    ? undefined
    : [dbServer, ...DEV_SERVERS.map(([port, env]) => devServer(port, env)), prodServer],
})
