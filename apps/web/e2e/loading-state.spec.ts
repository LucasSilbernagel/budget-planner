import { type Page, expect, test } from '@playwright/test'

/**
 * Store-rehydration loading states (story 38.2, UX-DR43).
 *
 * ## What this file proves that nothing else can
 *
 * The **server HTML** is the only place the pending state can be observed
 * deterministically. In a real browser it lasts about one frame; asserting on a
 * raced `getByTestId()` right after `goto` is flake, not a test. So the pending
 * assertions here read `response.text()` — no JavaScript runs, no timing is
 * involved, and it is literally the bytes a user (or a crawler) receives first.
 *
 * Measured at `d66c821`, before this story, for a user with data: `/` served
 * `$0.00` in all three cards AND "Let's set up your budget" with an "+ Add
 * income" call to action. That is the defect, in the response body.
 *
 * ## ⚠️ Three traps this file is built around
 *
 * 1. **Only STORE-DERIVED content may be skeletoned.** `/` is the public landing
 *    page; if the wordmark, the subtitle, the privacy pillars or the Premium
 *    Features section leave the server response, this story has traded a UX bug
 *    for an SEO one, one story before Epic 40 goes to work on exactly that. The
 *    `static chrome survives` test is the fence, not decoration.
 * 2. **A skeleton must not reintroduce a hydration mismatch.** The gate is a
 *    mount gate precisely so the server render and the first client render agree
 *    by construction. `e2e/hydration.spec.ts` is the primary detector; the
 *    `no hydration error` case here is the story-local arm.
 * 3. **The seed must include `budget-planner:savings-goals`** — story 38.1 Trap
 *    6: a balance-only seed makes the Overview's net worth flip from `$0.00` to
 *    `-$142,000.00` with ZERO hydration errors, so it is structurally incapable
 *    of failing.
 */

const HYDRATION_ERROR = /Hydration failed|Minified React error #(418|423|425)/

function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    if (HYDRATION_ERROR.test(error.message)) errors.push(error.message)
  })
  return errors
}

function seedSavingsAndBalances() {
  const now = new Date().toISOString()
  localStorage.setItem(
    'budget-planner:savings-goals',
    JSON.stringify({
      state: {
        savingsGoals: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Emergency fund',
            targetAmount: 1000000,
            currentBalance: 300000,
            allocationMode: 'manual',
            monthlyAllocation: 20000,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 2,
    })
  )
  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({
      state: {
        incomeSources: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Salary',
            amount: 500000,
            frequency: 'monthly',
            categoryId: null,
            sortOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      version: 2,
    })
  )
}

/**
 * Every gated surface, paired with the skeleton that stands in for it and the
 * "confident zero" phrase that must NOT be in the server response.
 *
 * ⚠️ The `absent` strings are the point of this table. Asserting only that a
 * skeleton is present would pass on a page that ALSO still renders the zero
 * underneath it.
 *
 * ⚠️ `absent` names the VALUE (`$0.00`), never the element. The resolved
 * `<p data-testid="overview-net-worth">` is still in the pending markup — it is
 * what holds the placeholder, and keeping it is exactly what makes the footprint
 * match and every existing selector keep working. The first draft of this file
 * asserted the element was gone, which would have forced a worse design.
 */
const GATED_ROUTES = [
  {
    path: '/',
    skeletons: [
      'overview-total-income-skeleton',
      'overview-total-expenses-skeleton',
      'overview-net-worth-skeleton',
      'overview-sections-skeleton',
    ],
    absent: ['$0.00', 'set up your budget', '+ Add income'],
  },
  {
    path: '/income',
    skeletons: ['period-total-amount-skeleton', 'income-list-skeleton'],
    absent: ['$0.00', 'No income sources yet'],
  },
  {
    path: '/expenses',
    skeletons: ['period-total-amount-skeleton', 'expenses-list-skeleton'],
    absent: ['$0.00', 'No expenses recorded yet'],
  },
  {
    path: '/savings',
    skeletons: [
      'savings-total-skeleton',
      'savings-leftover-summary-skeleton',
      'savings-chart-skeleton',
      'savings-list-skeleton',
    ],
    absent: [
      '$0.00',
      'No savings goals recorded yet',
      // ⚠️ Added in code review. The chart section was outside every gate and
      // served this sentence to a returning user; neither the value sweep
      // (`$0.00`) nor the testid sweep could see it, because it is neither.
      'Add a savings goal to see it charted here',
      'savings-chart-empty',
    ],
  },
  {
    path: '/balance',
    skeletons: [
      'stat-total-investments-skeleton',
      'stat-total-savings-skeleton',
      'stat-total-assets-skeleton',
      'stat-total-debts-skeleton',
      'stat-net-worth-skeleton',
      'balance-entries-skeleton',
    ],
    absent: ['$0.00', 'No balance entries recorded yet'],
  },
] as const

test.describe('loading state — the server response', () => {
  for (const { path, skeletons, absent } of GATED_ROUTES) {
    test(`${path} serves skeletons, not a confident zero`, async ({ request }) => {
      const response = await request.get(path)
      expect(response.status(), `${path} did not return 200`).toBe(200)
      const html = await response.text()

      for (const testid of skeletons) {
        expect(html, `${path} is missing skeleton ${testid}`).toContain(testid)
      }
      for (const phrase of absent) {
        expect(html, `${path} still serves "${phrase}"`).not.toContain(phrase)
      }
      // One announced region per page — not one per skeleton.
      expect(
        html.split('data-testid="page-loading-status"').length - 1,
        `${path} must carry exactly one loading status region`
      ).toBe(1)
    })
  }

  /**
   * The fence. Static, store-independent content is NOT store-derived and must
   * survive untouched in the server response — this is what keeps the landing
   * page a landing page.
   */
  test('static chrome survives on / (the SEO fence)', async ({ request }) => {
    const html = await (await request.get('/')).text()

    // ⚠️ CLOSING TAGS, NOT BARE PHRASES — and the difference is the whole test.
    // The first version listed plain strings like "Track your finances with
    // privacy and control". Mutation M12 skeletoned the visible subtitle and the
    // test still PASSED, because that sentence also opens the
    // `<meta name="description">`, so `toContain` matched the head while the body
    // copy was gone. An assertion that cannot fail on the thing it guards is
    // worse than no assertion, because the suite reports it as covered.
    for (const markup of [
      '>Longhand Budget</h1>',
      '>Track your finances with privacy and control</p>',
      '>No account needed · Optional sync is EU-hosted · No bank connection.</p>',
      '>Premium Features</h2>',
      '>Multi-device sync</span>',
      '>Advanced Forecasting</span>',
    ]) {
      expect(html, `/ lost static content: ${markup}`).toContain(markup)
    }
  })
})

test.describe('loading state — resolution in a real browser', () => {
  test('the Overview resolves to the real figure with no hydration error', async ({ page }) => {
    const hydrationErrors = collectHydrationErrors(page)

    await page.addInitScript(seedSavingsAndBalances)
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)

    await expect(page.getByTestId('overview-net-worth')).toHaveText('$3,000.00')
    await expect(page.getByTestId('overview-net-worth-skeleton')).toHaveCount(0)
    await expect(page.getByTestId('page-loading-status')).toHaveCount(0)

    await page.waitForLoadState('networkidle')
    expect(hydrationErrors, `hydration errors on /:\n${hydrationErrors.join('\n---\n')}`).toEqual(
      []
    )
  })

  /**
   * The arm that catches "skeleton forever": with empty storage the gate must
   * still resolve, and it must resolve to the GENUINE empty state — the one
   * thing the skeleton is not allowed to look like.
   */
  test('an empty store resolves to the real empty state, not a permanent skeleton', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page.getByText(/set up your budget/i)).toBeVisible()
    await expect(page.getByTestId('overview-net-worth')).toHaveText('$0.00')
    await expect(page.getByTestId('overview-net-worth-skeleton')).toHaveCount(0)
    await expect(page.getByTestId('page-loading-status')).toHaveCount(0)
  })
})

/**
 * Positive controls for the `absent` table.
 *
 * ⚠️ Raised in code review, and the point is subtle: `expect(html).not.toContain(x)`
 * passes just as happily when `x` is a string the app NEVER emits. Nothing in
 * this file asserted that "+ Add income" or any per-page empty sentence is
 * actually PRESENT in a resolved render — so a copy edit ("Add income" →
 * "Add an income source") would silently disarm the corresponding `absent`
 * entry and the suite would stay green while the fence stopped guarding
 * anything. These arms make every `absent` string falsifiable from both sides.
 */
test.describe("positive controls — the absent strings really are the app's copy", () => {
  const RESOLVED_EMPTY_COPY = [
    { path: '/', phrases: ["Let's set up your budget", '+ Add income', '$0.00'] },
    { path: '/income', phrases: ['No income sources yet', '$0.00'] },
    { path: '/expenses', phrases: ['No expenses recorded yet', '$0.00'] },
    {
      path: '/savings',
      phrases: [
        'No savings goals recorded yet',
        'Add a savings goal to see it charted here',
        '$0.00',
      ],
    },
    { path: '/balance', phrases: ['No balance entries recorded yet', '$0.00'] },
  ] as const

  for (const { path, phrases } of RESOLVED_EMPTY_COPY) {
    test(`${path} really renders every phrase its fence claims to exclude`, async ({ page }) => {
      await page.goto(path)
      // Wait for the gate to resolve before reading the DOM, or this races the
      // very state it is the control for.
      await expect(page.getByTestId('page-loading-status')).toHaveCount(0)

      const body = await page.locator('body').innerText()
      const html = await page.content()
      for (const phrase of phrases) {
        expect(
          body.includes(phrase) || html.includes(phrase),
          `${path} never renders "${phrase}" — the matching \`absent\` assertion is guarding nothing`
        ).toBe(true)
      }
    })
  }
})

/**
 * Every gated page actually leaves the pending state.
 *
 * ⚠️ Raised in code review: only `/` had a real-browser resolution arm, so an
 * inverted or stuck gate on any other page would have been caught by nothing but
 * server-HTML string checks — which cannot see whether the skeleton ever goes
 * away.
 */
test.describe('every gated page resolves', () => {
  const RESOLUTION = [
    { path: '/', marker: 'overview-net-worth', skeleton: 'overview-net-worth-skeleton' },
    { path: '/income', marker: 'period-total-amount', skeleton: 'period-total-amount-skeleton' },
    { path: '/expenses', marker: 'period-total-amount', skeleton: 'period-total-amount-skeleton' },
    { path: '/savings', marker: 'savings-leftover-summary', skeleton: 'savings-chart-skeleton' },
    // ⚠️ Repointed by story 43.1: this row's original probe was
    // `balance-investments-skeleton`, deleted with the Investment Accounts
    // section. A probe naming an absent testid passes `toHaveCount(0)`
    // instantly, so /balance would have kept a GREEN row that proved nothing.
    { path: '/balance', marker: 'stat-net-worth', skeleton: 'balance-entries-skeleton' },
  ] as const

  for (const { path, marker, skeleton } of RESOLUTION) {
    test(`${path} clears every skeleton and its status region`, async ({ page }) => {
      const hydrationErrors = collectHydrationErrors(page)

      await page.addInitScript(seedSavingsAndBalances)
      const response = await page.goto(path)
      expect(response?.status(), `${path} did not return 200`).toBe(200)

      await expect(page.getByTestId(marker)).toBeVisible()
      await expect(page.getByTestId(skeleton)).toHaveCount(0)
      await expect(page.getByTestId('page-loading-status')).toHaveCount(0)
      await expect(page.locator('[data-testid$="-skeleton"]')).toHaveCount(0)

      await page.waitForLoadState('networkidle')
      expect(
        hydrationErrors,
        `hydration errors on ${path}:\n${hydrationErrors.join('\n---\n')}`
      ).toEqual([])
    })
  }
})

/**
 * The pending state must not come BACK on a client-side navigation.
 *
 * ⚠️ This is the regression a reviewer found in the first implementation: the
 * gate was a fresh `useState(false)` per mount, so SPA-navigating to the Overview
 * remounted it pending and replayed the whole skeleton→charts layout jump — every
 * single time, minutes after the stores had filled. Nothing in the suite
 * navigated between routes, so nothing could see it.
 */
test('a client-side navigation does not re-enter the pending state', async ({ page }) => {
  await page.addInitScript(seedSavingsAndBalances)
  await page.goto('/income')
  await expect(page.getByTestId('period-total-amount')).toBeVisible()
  await expect(page.getByTestId('page-loading-status')).toHaveCount(0)

  // ⚠️ A MUTATION OBSERVER, NOT A RETRYING LOCATOR — and this is the whole test.
  //
  // The first version simply asserted `toHaveCount(0)` on the skeletons after
  // clicking. Every Playwright assertion auto-retries, and the regression it
  // targets is a ONE-FRAME flash, so the mutation that reverts the fix
  // (`useState(hydratedOnThisClient)` → `useState(false)`) left this file passing
  // 19/19. The test was a race — exactly the failure mode this story's own notes
  // warn against: "do not assert on a raced getByTestId() immediately after goto;
  // that is flake, not a test." Caught by re-arming the review fix as a mutation.
  //
  // An observer sees every insertion regardless of when a poller happens to look,
  // so the assertion is about what the DOM DID, not what it looked like at one
  // sampled instant.
  const PENDING_SELECTOR = '[data-testid$="-skeleton"], [data-testid="page-loading-status"]'
  await page.evaluate((selector) => {
    const w = window as unknown as { __pendingSeen?: string[] }
    w.__pendingSeen = []
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element)) continue
          const hits = node.matches(selector) ? [node] : Array.from(node.querySelectorAll(selector))
          for (const element of hits) {
            w.__pendingSeen?.push(element.getAttribute('data-testid') ?? '?')
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true })
  }, PENDING_SELECTOR)

  // The nav uses TanStack `<Link>`, so this is a client transition, not a reload.
  await page.getByRole('link', { name: 'Overview' }).first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('overview-net-worth')).toHaveText('$3,000.00')
  await page.waitForLoadState('networkidle')

  const seen = await page.evaluate(
    () => (window as unknown as { __pendingSeen?: string[] }).__pendingSeen ?? []
  )
  expect(
    seen,
    `the client navigation re-entered the pending state and inserted: ${seen.join(', ')}`
  ).toEqual([])
})
