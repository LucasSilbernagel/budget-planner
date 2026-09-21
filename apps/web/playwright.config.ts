import { defineConfig, devices } from '@playwright/test'

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
 */
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
      // Excluded, not merely unlisted: without this the paid specs would ALSO run
      // here, against the free server, and their paid assertions would fail for a
      // reason that looks nothing like "wrong server".
      testIgnore: /\.paid\.spec\.ts$/,
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
            use: { ...devices['Desktop Chrome'], baseURL: paidBaseURL },
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
      ],
})
