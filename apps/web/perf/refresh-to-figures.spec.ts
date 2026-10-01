import { type Page, expect, test } from '@playwright/test'

/**
 * M2 — refresh-to-figures (story 38.3, NFR9).
 *
 * ## What is measured
 *
 * Milliseconds from the document's navigation start (`performance.timeOrigin`,
 * which is what `performance.now()` counts from inside a freshly navigated
 * document) to the moment `[data-testid="overview-net-worth"]` holds the user's
 * REAL figure.
 *
 * ## The instrument OBSERVES the transition; it does not poll for it
 *
 * The figure arrives in a single frame. Story 38.2's review recorded what happens
 * when you assert on that with a locator: the new "client navigation does not
 * re-enter pending" test used auto-retrying `toHaveCount(0)` against a one-frame
 * flash, so reverting the fix left it passing 19/19. And
 * `loading-state.spec.ts:8-11` (deleted by story 84.4): "asserting on a raced `getByTestId()` right after
 * `goto` is flake, not a test."
 *
 * So the timestamp comes from a {@link MutationObserver} armed in
 * `addInitScript` — before any app script runs. The Playwright assertion that
 * follows is only a WAIT: it guarantees we do not read `window.__figure` before
 * the page resolved. It never supplies the number.
 *
 * ## ⚠️ The element already exists in the SSR HTML
 *
 * Story 38.2 kept the `<p data-testid="overview-net-worth">` and swapped only its
 * CONTENT for a skeleton — an explicit decision ("It asserted the resolved element
 * disappears. It does not, and it must not."). So the predicate keys on the TEXT
 * becoming a real currency figure, never on the element appearing. {@link isRealFigure}
 * additionally rejects `$0.00`, so a skeleton, an empty render, or a genuinely
 * empty store can never satisfy the metric.
 *
 * ## Manual only, outside every suite (story 84.5, D3, Lucas 2026-10-01)
 *
 * This file is the MEASUREMENT: the 11-sample medians at 1x and 4x CPU that
 * produced NFR9's numbers, with the throttle and cache controls. It lives in
 * `apps/web/perf/` and runs ONLY through `playwright.perf.config.ts`, which the
 * default `playwright test` (every gate, every CI run) never loads. It ran in no
 * gate before either: it was env-gated inside `e2e/`, and the four always-on
 * tests beside it checked the INSTRUMENT, not the app. Those were dropped; the
 * one app claim among them ("the SSR response carries NO chart library") moved to
 * `src/__tests__/served-pages.served.test.ts`.
 *
 * Run it against a production build you started yourself (a number measured
 * against a Vite dev server is a number about Vite, not about the app):
 *
 *   pnpm --filter web build
 *   cd apps/web && DATABASE_URL='' PORT=8080 node server-entry.mjs   # leave running
 *   cd apps/web && PLAYWRIGHT_BASE_URL=http://localhost:8080 \
 *     ./node_modules/.bin/playwright test --config playwright.perf.config.ts
 *
 * (Exactly what ran at story 84.5's close: `84-5-evidence/perf-run.log`.)
 *
 * ⚠️ **Never turn M2 into a CI assertion.** A shared CI runner's timings are a
 * property of the runner, and the repo already carries the lesson that a flaky
 * gate invites re-running until green.
 */

/**
 * Budget for a WAIT (a first load can be slow, e.g. a cold server or a throttled
 * CPU). NOT a performance budget — no
 * assertion in this file compares against it.
 */
const COLD_COMPILE_TIMEOUT_MS = 60_000

/** Sample count per condition. Odd, so the median is a real reading. */
const SAMPLES = 11

/**
 * The seeded data size, stated as a number of rows so the measurement is
 * reproducible from the story text alone (AC-3).
 *
 * 3 income + 5 expenses + 2 savings goals + 4 balance entries = 14 rows across
 * four persisted stores.
 */
const SEED_SIZE = { income: 3, expenses: 5, savingsGoals: 2, balanceEntries: 4 } as const

/**
 * Net worth is `investments + savings − debts` (`hooks/useNetWorth.ts`).
 * From the seed below, in cents:
 *   investments 800_000 + 4_200_000 = 5_000_000
 *   savings       250_000 +  50_000 =   300_000
 *   debts         350_000 +  45_000 =   395_000
 *   → 5_000_000 + 300_000 − 395_000 = 4_905_000 cents
 *
 * The store default currency is `$`/USD, and nothing in the seed changes it.
 */
const EXPECTED_NET_WORTH = '$49,050.00'

/**
 * Fixed UUIDs and a fixed timestamp — `crypto.randomUUID()` and `new Date()` would
 * make the run unreproducible, which is the one thing a baseline may not be.
 *
 * Every envelope carries its OWN store's current version — 3 for income/expenses/
 * savings, 4 for balance — so no `migrate` runs. That is deliberate: a returning
 * user's storage is at the current version, and the migration path is not what
 * this story measures.
 *
 * ⚠️ The versions are NOT uniform and must not be "tidied" back to a single
 * number. Story 49.1 bumped `balanceStore` to 4 (it strips a retired key); until
 * this note the balance envelope still said 3, which silently put `/balance`
 * through `migrate` on every run and made this comment's own claim false while
 * every assertion stayed green. Check `<store>.ts`'s `persist` options when
 * adding an envelope.
 *
 * ⚠️ The savings store is seeded on purpose and must stay seeded. Story 38.1's
 * Trap 6: a balance-only seed flips the Overview's net worth with ZERO hydration
 * errors, because both balance selectors are pure. **The seed, not the assertion,
 * decides whether a detector can fire.**
 */
function seedOverview() {
  const now = '2026-01-01T00:00:00.000Z'
  const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`

  localStorage.setItem(
    'budget-planner:savings-goals',
    JSON.stringify({
      state: {
        savingsGoals: [
          {
            id: id(1),
            name: 'Emergency fund',
            targetAmount: 1000000,
            currentBalance: 250000,
            allocationMode: 'manual',
            monthlyAllocation: 20000,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(2),
            name: 'Rainy day',
            targetAmount: null,
            currentBalance: 50000,
            allocationMode: 'manual',
            monthlyAllocation: 10000,
            sortOrder: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 3,
    })
  )

  localStorage.setItem(
    'budget-planner:balance-tracking',
    JSON.stringify({
      state: {
        entries: [
          {
            id: id(3),
            type: 'investment',
            name: 'ISA',
            currentBalance: 800000,
            monthlyContribution: 0,
            frequency: 'monthly',
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(4),
            type: 'investment',
            name: 'Pension',
            currentBalance: 4200000,
            monthlyContribution: 0,
            frequency: 'monthly',
            sortOrder: 1,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(5),
            type: 'debt',
            name: 'Car loan',
            currentBalance: 350000,
            monthlyContribution: 0,
            frequency: 'monthly',
            sortOrder: 2,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(6),
            type: 'debt',
            name: 'Credit card',
            currentBalance: 45000,
            monthlyContribution: 0,
            frequency: 'monthly',
            sortOrder: 3,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 4, // balanceStore is at 4 since story 49.1 — see the note above
    })
  )

  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({
      state: {
        incomeSources: [
          {
            id: id(7),
            name: 'Salary',
            amount: 500000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(8),
            name: 'Freelance',
            amount: 80000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 1,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(9),
            name: 'Dividends',
            amount: 120000,
            frequency: 'annually',
            categoryId: null,
            sortOrder: 2,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 3,
    })
  )

  localStorage.setItem(
    'budget-planner-expenses-v1',
    JSON.stringify({
      state: {
        expenses: [
          {
            id: id(10),
            name: 'Rent',
            amount: 150000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(11),
            name: 'Groceries',
            amount: 60000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 1,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(12),
            name: 'Utilities',
            amount: 25000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 2,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(13),
            name: 'Transport',
            amount: 18000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 3,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: id(14),
            name: 'Subscriptions',
            amount: 4500,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 4,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 3,
    })
  )
}

/** What {@link armFigureObserver} leaves on `window`. */
interface FigureReading {
  /** `performance.now()` at the first real figure, or `null` if it never arrived. */
  at: number | null
  /** The text that satisfied the predicate. */
  text: string | null
  /** `'observer'` on the normal path; `'initial'` means it was already resolved at document start. */
  source: 'observer' | 'initial' | null
  /** Whether the MutationObserver callback ever ran at all. */
  observerRan: boolean
}

/**
 * Arm the instrument. Must be installed with `page.addInitScript` BEFORE `goto`.
 *
 * ⚠️ `source` is the anti-vacuity field. If a future change made the figure present
 * at document start, `at` would still be a number and the test would still pass —
 * but it would be measuring nothing. {@link assertHonest} requires `'observer'`.
 */
function armFigureObserver() {
  const w = window as unknown as { __figure?: FigureReading }
  const reading: FigureReading = { at: null, text: null, source: null, observerRan: false }
  w.__figure = reading

  const read = (): string | null => {
    const el = document.querySelector('[data-testid="overview-net-worth"]')
    const text = el?.textContent?.trim()
    return text === undefined || text === '' ? null : text
  }

  // A real figure is currency-shaped AND not the confident zero. Story 38.2 removed
  // every `$0.00` from the server response for `/`; if one ever comes back, this
  // metric must not count it as the user's figure.
  // ⚠️ Both halves were loosened by code review's counter-examples. The shape check
  // used to be `[\d,]+`, which accepts `$,.00` and `$1,2,3.00`; it now requires
  // well-formed thousands groups. And the zero check used to be an exact compare
  // against `'$0.00'`, which let `-$0.00` — a real `Intl` output for a negative
  // near-zero — count as the user's figure, in an instrument documented as one a
  // zero can never satisfy. Parsing the number closes both.
  const isRealFigure = (text: string | null): boolean => {
    if (text === null || !/^-?\$\d{1,3}(?:,\d{3})*\.\d{2}$/.test(text)) {
      return false
    }
    return Number.parseFloat(text.replace(/[$,]/g, '')) !== 0
  }

  const record = (source: 'observer' | 'initial', text: string) => {
    if (reading.at !== null) return
    reading.at = performance.now()
    reading.text = text
    reading.source = source
  }

  const initial = read()
  if (isRealFigure(initial)) record('initial', initial as string)

  const observer = new MutationObserver(() => {
    reading.observerRan = true
    if (reading.at !== null) return
    const text = read()
    if (isRealFigure(text)) record('observer', text as string)
  })
  observer.observe(document, { subtree: true, childList: true, characterData: true })
}

/**
 * A named measurement condition. `network: null` means unthrottled transport.
 *
 * ⚠️ **The loopback condition flatters a byte saving into invisibility, and that
 * is why more than one condition is measured here.** Serving from the same
 * machine, 110 KB of gzipped JavaScript arrives in ~0 ms, so removing it can only
 * save the parse/compile time — a fraction of what the same removal saves a user
 * on a real connection, where the bytes must also cross the wire. Measuring only
 * over loopback would understate the change; measuring only over a modelled
 * network would overstate the confidence. Both are reported.
 */
interface Condition {
  name: string
  cpu: number
  network: { downloadKbps: number; uploadKbps: number; latencyMs: number } | null
  /**
   * Serve every asset from the network instead of the HTTP cache.
   *
   * ⚠️ This flag is what separates "the browser must fetch everything again" from
   * "…over a modelled connection", and adding it is how the removed Fast-3G arm was
   * shown to be inert. A REFRESH re-reads its JavaScript from the HTTP cache, so for
   * the returning user this story is about, a byte saving buys parse time, not
   * transfer time. Transfer is what a FIRST visit pays — which is what this models.
   */
  coldCache: boolean
}

/**
 * The conditions the story reports.
 *
 * ⚠️ **A modelled "Fast 3G" arm was REMOVED here rather than fixed.** It was measured
 * against a cold-cache loopback arm added specifically to separate cache from
 * bandwidth, and the two came out at 610.0ms vs 610.6ms — `Network.emulateNetworkConditions`
 * was contributing nothing through this harness. Keeping it would have meant shipping
 * a condition whose LABEL claimed a modelled connection it did not have, which is the
 * failure this story exists to avoid. No bandwidth claim is made anywhere; the
 * cold-cache arm carries the first-visit case instead.
 */
const CONDITIONS: Condition[] = [
  // What a RETURNING user experiences: the assets are already cached, so a byte
  // saving buys parse time only.
  { name: 'cpu 1x, loopback, warm cache', cpu: 1, network: null, coldCache: false },
  { name: 'cpu 4x, loopback, warm cache', cpu: 4, network: null, coldCache: false },
  // What a FIRST visit pays, and the only condition here under which removing bytes
  // can save transfer rather than only parse time.
  { name: 'cpu 4x, loopback, cold cache', cpu: 4, network: null, coldCache: true },
]

/**
 * Apply a condition for the life of this page. `cpu: 1` with `network: null` is
 * no throttling at all.
 */
async function applyCondition(page: Page, condition: Condition): Promise<void> {
  const client = await page.context().newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: condition.cpu })
  await client.send('Network.enable')
  await client.send('Network.setCacheDisabled', { cacheDisabled: condition.coldCache })
  if (condition.network !== null) {
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      // CDP wants bytes/second; the preset is quoted in kilobits.
      downloadThroughput: (condition.network.downloadKbps * 1000) / 8,
      uploadThroughput: (condition.network.uploadKbps * 1000) / 8,
      latency: condition.network.latencyMs,
    })
  }
}

/**
 * One measurement. Returns the reading the in-page observer recorded.
 *
 * `about:blank` first so every sample is an unambiguously fresh document with the
 * init scripts re-run, rather than relying on `goto`-to-the-same-URL semantics.
 */
async function measureOnce(page: Page): Promise<FigureReading> {
  await page.goto('about:blank')
  await page.goto('/', { waitUntil: 'commit' })
  // A WAIT, not the measurement: the number is already recorded in-page by the
  // time this resolves, so a longer timeout cannot inflate it. (It was sized for a
  // cold Vite dev server, where the 5 s default failed at ~5.1 s, when this file
  // still ran in `e2e/`.)
  await expect(page.getByTestId('overview-net-worth')).toHaveText(EXPECTED_NET_WORTH, {
    timeout: COLD_COMPILE_TIMEOUT_MS,
  })
  return await page.evaluate(() => (window as unknown as { __figure: FigureReading }).__figure)
}

/** Every reading must be observed, real, and equal to the seeded figure. */
function assertHonest(reading: FigureReading): void {
  expect(reading.observerRan, 'the MutationObserver never ran — the instrument was not armed').toBe(
    true
  )
  expect(
    reading.source,
    `expected the timestamp to come from the observer, got source=${reading.source}`
  ).toBe('observer')
  expect(reading.text, 'the recorded text must be the seeded figure').toBe(EXPECTED_NET_WORTH)
  expect(reading.at, 'no timestamp was recorded').not.toBeNull()
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[(sorted.length - 1) >> 1] as number
}

test.describe('refresh-to-figures (story 38.3, NFR9)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedOverview)
    await page.addInitScript(armFigureObserver)
  })

  /** The numbers the story reports. Recipe: this file's header. */
  test.describe('MEASUREMENT', () => {
    test('medians under each named condition, with the throttle control', async ({ page }) => {
      expect(
        process.env['PLAYWRIGHT_BASE_URL'],
        'set PLAYWRIGHT_BASE_URL to a production build you started (recipe: this file header)'
      ).toBeTruthy()
      test.setTimeout(900_000)

      // AC-2 pins 1280x720 and says "name it, do not rely on it being implied" —
      // so assert it. A `playwright.config.ts` change would otherwise move the
      // measured viewport silently, and every recorded median with it.
      expect(page.viewportSize()).toEqual({ width: 1280, height: 720 })

      const medians = new Map<string, number>()
      for (const condition of CONDITIONS) {
        await applyCondition(page, condition)
        const readings: number[] = []
        for (let i = 0; i < SAMPLES; i++) {
          const reading = await measureOnce(page)
          assertHonest(reading)
          readings.push(reading.at as number)
        }
        const sorted = [...readings].sort((a, b) => a - b)
        medians.set(condition.name, median(readings))
        console.log(
          `[M2] ${condition.name} | seed=${JSON.stringify(SEED_SIZE)} n=${SAMPLES} median=${median(
            readings
          ).toFixed(1)}ms ` +
            `min=${(sorted[0] as number).toFixed(1)}ms ` +
            `max=${(sorted[sorted.length - 1] as number).toFixed(1)}ms ` +
            `all=[${sorted.map((v) => v.toFixed(0)).join(', ')}]`
        )
      }

      // ⚠️ THE THROTTLE CONTROL, AND IT IS THE POINT OF THIS TEST (AC-5.1).
      // If `Emulation.setCPUThrottlingRate` silently failed — a renamed CDP
      // method, a browser that ignored it, a session opened against the wrong
      // target — every loop would measure an UNTHROTTLED page and the "4x"
      // figures would be fabrications indistinguishable from real ones. That is
      // exactly the shape story 37.1 shipped: a number labelled measured that was
      // never computed. Asserting the ratios is what makes the label earned.
      const fast = medians.get('cpu 1x, loopback, warm cache') as number
      const slowCpu = medians.get('cpu 4x, loopback, warm cache') as number
      const cold = medians.get('cpu 4x, loopback, cold cache') as number
      console.log(
        `[control:throttle] cpu 4x/1x = ${(slowCpu / fast).toFixed(2)}x | cold/warm @4x = ${(
          cold / slowCpu
        ).toFixed(2)}x`
      )
      const cpuWhy = `4x median (${slowCpu.toFixed(
        1
      )}ms) is not above the 1x median (${fast.toFixed(
        1
      )}ms) — the CPU throttle did not take, so neither figure means what it says`
      expect(slowCpu, cpuWhy).toBeGreaterThan(fast * 1.5)
      // ⚠️ This compares cold-cache against warm-cache at the SAME cpu rate, so
      // exactly one variable changes. The assertion it replaced compared a
      // Fast-3G-cold arm against a loopback-WARM arm and blamed
      // `Network.emulateNetworkConditions` for a gap the disabled cache produced on
      // its own — it passed on a run where the story's own diagnostic measured the
      // emulation contributing nothing (610.6ms vs 610.0ms).
      const cacheWhy = `the cold-cache median (${cold.toFixed(
        1
      )}ms) is not above the warm-cache median at the same CPU rate (${slowCpu.toFixed(
        1
      )}ms) — Network.setCacheDisabled did not take`
      expect(cold, cacheWhy).toBeGreaterThan(slowCpu * 1.2)
    })
  })
})
