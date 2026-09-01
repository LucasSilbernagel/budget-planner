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
 * `loading-state.spec.ts:8-11`: "asserting on a raced `getByTestId()` right after
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
 * ## Two arms, and why they are split
 *
 * - **Always-on** (this file's default): deterministic, relative, server-agnostic
 *   assertions that keep the harness honest — the observer fired, the value is
 *   real, an injected delay MOVES the number, and an unseeded page never records.
 *   No absolute millisecond threshold is asserted anywhere, so there is nothing
 *   here for a slow host to trip.
 * - **Env-gated** (`REFRESH_TO_FIGURES=1`): the 11-sample medians at 1x and 4x CPU
 *   that produced the numbers in the story. Gated for the same reason
 *   `pwa.spec.ts:70-76` gates its built-server block: the default `pnpm test:e2e`
 *   boots `pnpm dev` (`playwright.config.ts:35`), and a refresh-to-figures time
 *   measured against a Vite dev server is a number about Vite, not about the app.
 *
 * ⚠️ **Never turn M2 into a CI assertion.** CI runs `workers: 1`, `retries: 2` on a
 * shared runner against the dev server. The repo already carries the lesson that a
 * flaky gate invites re-running until green.
 */

/**
 * Discarded loads before the sensitivity control's baseline, and how many baseline
 * samples it then takes. Both absorb the dev server's on-demand compile — see the
 * comment in that test.
 */
/**
 * Budget for a wait that may be the first request to a cold dev server, which pays
 * Vite's on-demand compile of the whole route graph. NOT a performance budget — no
 * assertion in this file compares against it.
 */
const COLD_COMPILE_TIMEOUT_MS = 60_000

const WARMUP_LOADS = 2
const BASELINE_SAMPLES = 3

/** Sample count for the env-gated measurement arm. Odd, so the median is a real reading. */
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

/**
 * A Playwright bounding box.
 *
 * ⚠️ Spelled out rather than derived. The first version wrote
 * `Awaited<ReturnType<typeof page.locator>['boundingBox']>`, which indexes the LOCATOR
 * type to get the METHOD's type — not its return type — so the map's values were typed
 * as a function signature and three `.height`/`.width`/`.y` reads below were type
 * errors. Nothing caught it: `apps/web/tsconfig.app.json` includes only `src/**`, so
 * NO tsconfig in this repo covers `e2e/`, and all 32 specs are unchecked by the gate.
 */
interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
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
 * Delay the FIRST script request by `ms`, let every other request through, and
 * return the live count of requests actually delayed.
 *
 * ⚠️ The RETURN VALUE is the mechanism check, and it exists because of story 38.2's
 * review finding RF4: the first version of the footprint spec's guard re-read the
 * DOM after measuring, and disabling the blocker left it passing 5/5 because every
 * read finished inside the pre-hydration window anyway. **A timing-dependent guard
 * against a timing bug is not a guard.** Count what was actually delayed.
 */
async function delayFirstScript(page: Page, ms: number): Promise<{ count: number }> {
  const delayed = { count: 0 }
  // ⚠️ AWAITED. `page.route()` resolves once interception is installed; discarding
  // the promise let `goto` race ahead of it, leaving `count` at 0 and failing the
  // anti-vacuity assertion nondeterministically — a flaky red in a file whose header
  // warns that a flaky gate invites re-running until green.
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script' && delayed.count === 0) {
      delayed.count++
      await new Promise((resolve) => setTimeout(resolve, ms))
      return route.continue()
    }
    return route.continue()
  })
  return delayed
}

/**
 * Hold the lazily-imported chart chunk for `ms`, and return the live count of
 * requests actually held.
 *
 * ⚠️ The glob matches on BOTH servers on purpose: Vite's dev module URL carries
 * `HomeChartCanvases.tsx`, and the production chunk is named
 * `HomeChartCanvases-<hash>.js` because Rollup names a chunk after a module in
 * it. Story 38.2's review recorded the cost of getting this wrong from the other
 * side: its abort glob matched a DEV-ONLY virtual module and would have matched
 * nothing against a production build, silently turning every "pending" reading
 * into a resolved one.
 *
 * ⚠️ The count is the mechanism check (38.2 review, RF4). A footprint comparison
 * in which nothing was actually held compares the resolved box against itself and
 * passes trivially.
 */
async function holdChartChunk(page: Page, ms: number): Promise<{ count: number }> {
  const held = { count: 0 }
  // ⚠️ AWAITED — see delayFirstScript.
  await page.route('**/*HomeChartCanvases*', async (route) => {
    held.count++
    await new Promise((resolve) => setTimeout(resolve, ms))
    return route.continue()
  })
  return held
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
  // A WAIT, not the measurement. The number is already recorded in-page by then.
  // A WAIT, not the measurement — but its timeout must outlast a COLD Vite compile,
  // which the 5s default does not. Measured: on a cold dev server (cache cleared) the
  // first load of `/` blew the default and failed this file's first test at ~5.1s,
  // while the figure itself was fine. The number is already recorded in-page by the
  // time this resolves, so a longer wait cannot inflate it.
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

  test('the instrument records an OBSERVED timestamp for the real figure', async ({ page }) => {
    const reading = await measureOnce(page)
    assertHonest(reading)
    // Sanity, not a budget: a navigation cannot complete before it starts.
    expect(reading.at as number).toBeGreaterThan(0)
    console.log(
      `[refresh-to-figures] seed=${JSON.stringify(SEED_SIZE)} figure=${reading.text} t=${(
        reading.at as number
      ).toFixed(1)}ms`
    )
  })

  test('SENSITIVITY CONTROL: an injected delay moves the number', async ({ page }) => {
    // ⚠️ WARM-UP AND A MIN-OF-N BASELINE, AND NEITHER IS OPTIONAL.
    //
    // Against the dev server the first loads of `/` pay Vite's on-demand compile of
    // the route graph. Measuring `baseline` cold and `delayed` warm makes the
    // subtraction `(warm + DELAY_MS) - cold`, which goes NEGATIVE. That is measured,
    // not feared: code review predicted it, the full suite then failed on it, and a
    // deliberate cold-server reproduction (Vite cache cleared) recorded
    // `baseline=3232.7ms delayed=2510.3ms moved=-722.4ms`.
    //
    // One warm-up load was NOT enough — Vite keeps compiling across later requests.
    // So: warm up, then take several baseline samples and keep the MINIMUM. A cold
    // outlier can only INFLATE a baseline, and an inflated baseline is exactly what
    // shrinks `moved` below the floor, so the minimum is the conservative estimator —
    // it biases against the assertion rather than towards it.
    for (let i = 0; i < WARMUP_LOADS; i++) {
      await measureOnce(page)
    }

    const baselineSamples: number[] = []
    for (let i = 0; i < BASELINE_SAMPLES; i++) {
      const sample = await measureOnce(page)
      assertHonest(sample)
      baselineSamples.push(sample.at as number)
    }
    const baselineAt = Math.min(...baselineSamples)

    const DELAY_MS = 1500
    const delayed = await delayFirstScript(page, DELAY_MS)
    const slowed = await measureOnce(page)
    assertHonest(slowed)

    // Count the mechanism first. If nothing was actually delayed, the comparison
    // below is meaningless however it comes out.
    expect(
      delayed.count,
      'no script request was delayed — the control proves nothing'
    ).toBeGreaterThanOrEqual(1)

    // Deliberately generous: the point is that the instrument tracks real elapsed
    // time, not that it tracks it to the millisecond. A metric that cannot show a
    // 1.5s regression cannot show an improvement either.
    const moved = (slowed.at as number) - baselineAt
    console.log(
      `[control:sensitivity] baseline=${baselineAt.toFixed(1)}ms ` +
        `(min of ${BASELINE_SAMPLES}: ${baselineSamples.map((v) => v.toFixed(0)).join(', ')}) ` +
        `delayed=${(slowed.at as number).toFixed(1)}ms moved=+${moved.toFixed(1)}ms ` +
        `(injected ${DELAY_MS}ms into ${delayed.count} script request)`
    )
    // ⚠️ THE CONTROL MUST STATE ITS OWN PRECONDITION, and this first assertion is
    // why. Mutation M12 set `DELAY_MS = 0` and this test still PASSED, because the
    // threshold below is derived from the very constant the mutation zeroed:
    // `moved > 0 * 0.6` is satisfied by any drift at all. The control could not
    // fail in the one way it most needed to — the same shape as story 38.2's M12,
    // where an SEO fence matched the `<meta>` description and so could never fire.
    expect(
      DELAY_MS,
      'the injected delay is too small for the comparison below to mean anything'
    ).toBeGreaterThanOrEqual(1000)

    // Deliberately generous: the point is that the instrument tracks real elapsed
    // time, not that it tracks it to the millisecond. A metric that cannot show a
    // 1.5s regression cannot show an improvement either.
    expect(
      moved,
      `a ${DELAY_MS}ms delay moved the measurement by only ${moved.toFixed(1)}ms`
    ).toBeGreaterThan(DELAY_MS * 0.6)
  })

  test('the SSR response carries NO chart library (AC-10)', async ({ page }) => {
    // ⚠️ THIS TEST EXISTS BECAUSE MUTATION M9 REFUTED THE STORY'S OWN PREDICTION.
    // M9 hoisted a lazy chart boundary OUT of the `!hydrated` mount gate, so the
    // server rendered chart markup and the client's first render rendered the
    // Suspense fallback. `e2e/hydration.spec.ts` was predicted to go red. It
    // stayed GREEN, 9/9 — React treats a Suspense boundary that resolves
    // differently on the server and the client as ordinary Suspense behaviour,
    // not as a hydration mismatch, so no `pageerror` ever fires. Nothing in the
    // suite caught it.
    //
    // So the property has to be asserted directly: the chart library must not
    // reach the SSR response at all. That is both the hydration fence AND the
    // critical-path fence, and unlike the hydration detector it cannot be
    // satisfied by silence.
    //
    // ⚠️ Asserted through `response.text()`, never a shell `grep`. The `/`
    // response contains NUL bytes inside the serialized router payload, so GNU
    // grep classifies it as binary and prints nothing without `-a` — exit 1 and
    // no output, indistinguishable from a genuine zero.
    const response = await page.goto('/', { waitUntil: 'commit' })
    const html = (await response?.text()) ?? ''
    expect(html.length, 'no SSR body was returned').toBeGreaterThan(1000)
    const hits = html.match(/recharts/g)?.length ?? 0
    expect(
      hits,
      `the SSR response for / contains ${hits} "recharts" occurrence(s). A chart rendered on the server means the chart library is back on the critical path, and — because Suspense hides it from the hydration detector — nothing else in this suite would tell you.`
    ).toBe(0)
  })

  test('VALUE CONTROL: an unseeded page never records a figure', async ({ page }) => {
    // Undo the seed from beforeEach — this visitor genuinely has no data.
    await page.addInitScript(() => localStorage.clear())

    await page.goto('about:blank')
    await page.goto('/', { waitUntil: 'commit' })
    // Wait for the page to resolve to its real empty state before reading.
    await expect(page.getByTestId('overview-net-worth')).toHaveText('$0.00', {
      timeout: COLD_COMPILE_TIMEOUT_MS,
    })

    const reading = await page.evaluate(
      () => (window as unknown as { __figure: FigureReading }).__figure
    )
    console.log(
      `[control:value] unseeded page resolved to $0.00; recorded=${String(reading.at)} ` +
        `observerRan=${String(reading.observerRan)}`
    )
    expect(
      reading.at,
      `the metric was satisfied by "${reading.text}" — a skeleton or a zero must never count`
    ).toBeNull()
    // The observer DID run (the skeleton→$0.00 swap is a mutation); it simply
    // refused to record. That distinction is what makes this a control rather
    // than a test that the instrument was broken.
    expect(reading.observerRan, 'the observer never ran, so it proved nothing').toBe(true)
  })

  test('FOOTPRINT: deferring the charts changes no box, on EVERY deferred surface (AC-11)', async ({
    page,
  }) => {
    // Long enough that every measurement below finishes while the chunk is still
    // in flight — the pending state is held open, not raced.
    const held = await holdChartChunk(page, 8000)

    await page.goto('about:blank')
    await page.goto('/', { waitUntil: 'commit' })
    await expect(page.getByTestId('overview-net-worth')).toHaveText(EXPECTED_NET_WORTH, {
      timeout: COLD_COMPILE_TIMEOUT_MS,
    })

    // ⚠️ ALL THREE deferred surfaces, not one. Code review found this test measuring
    // only `breakdown-pie-income` — and the surface it skipped, the bar chart, is the
    // one sized by a COMPUTED inline style (`categoryChartHeight(data.length)`) rather
    // than a fixed class, i.e. the one most able to drift. The pie-labels test in this
    // same change preaches the rule: "Asserting only [0] would let one pie stand in
    // for two — the per-surface blind spot stories 30-4b, 33.3, 34.1b and 34.2 each hit."
    const SURFACES = [
      'breakdown-pie-income',
      'breakdown-pie-expense',
      'category-bar-flows',
    ] as const

    const pending = new Map<string, BoundingBox | null>()
    for (const testId of SURFACES) {
      const block = page.getByTestId(testId)
      await expect(block, `${testId} is not on the page`).toBeVisible()
      pending.set(testId, await block.boundingBox())
    }

    // Anti-vacuity, first half: the charts genuinely have not arrived yet.
    await expect(page.locator('.recharts-responsive-container')).toHaveCount(0)

    // Now let them land.
    await expect(page.locator('.recharts-responsive-container').first()).toBeVisible({
      timeout: 30_000,
    })

    expect(
      held.count,
      'the chart chunk was never held — nothing was measured pending'
    ).toBeGreaterThanOrEqual(1)

    for (const testId of SURFACES) {
      const resolved = await page.getByTestId(testId).boundingBox()
      const before = pending.get(testId)
      // A SAME-ELEMENT before/after comparison, never a pixel constant — the
      // host-independent shape `loading-state-footprint.spec.ts:6-18` established.
      // Whatever the font does, it does to both readings.
      console.log(
        `[footprint] ${testId} pending=${JSON.stringify(before)} resolved=${JSON.stringify(
          resolved
        )}`
      )
      expect(before, `${testId}: no pending box`).not.toBeNull()
      expect(resolved, `${testId}: no resolved box`).not.toBeNull()
      expect(resolved?.height, `${testId} changed height when the chart landed`).toBe(
        before?.height
      )
      expect(resolved?.width, `${testId} changed width when the chart landed`).toBe(before?.width)
      expect(resolved?.y, `${testId} MOVED when the chart landed`).toBe(before?.y)
    }
  })

  /**
   * The numbers the story reports. Gated because the default `pnpm test:e2e` boots
   * `pnpm dev`; run it against a production build you started yourself:
   *
   *   pnpm --filter web build
   *   PORT=8080 node apps/web/server-entry.mjs
   *   cd apps/web && REFRESH_TO_FIGURES=1 PLAYWRIGHT_BASE_URL=http://localhost:8080 \
   *     ./node_modules/.bin/playwright test e2e/refresh-to-figures.spec.ts --workers=1 --reporter=line
   */
  test.describe('MEASUREMENT', () => {
    test.skip(
      process.env['REFRESH_TO_FIGURES'] !== '1',
      'set REFRESH_TO_FIGURES=1 and point PLAYWRIGHT_BASE_URL at a production build'
    )

    test('medians under each named condition, with the throttle control', async ({ page }) => {
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
          `[M2] ${condition.name} | n=${SAMPLES} median=${median(readings).toFixed(1)}ms ` +
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
