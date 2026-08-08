import { expect, test } from '@playwright/test'

/**
 * Premium locked-state E2E (story 7-2, FR24).
 *
 * A first-time visitor has no session, so `usePremiumAccess` resolves to the
 * free tier on the client. This test drives the REAL hydration path (not a
 * mocked hook): after the client resolves the tier, the homepage must surface
 * Advanced Forecasting as a locked, discoverable control — with an upgrade
 * prompt on activation — rather than hiding it.
 *
 * This deliberately asserts the hydrated client DOM, the exact transition that
 * SSR-HTML smoke and mocked-only unit tests miss (project memory, 4-11).
 */
test('free visitor sees Advanced Forecasting locked and can open the upgrade prompt', async ({
  page,
}) => {
  await page.goto('/')

  // The gate renders a neutral skeleton during the in-flight tier check, then
  // resolves to the locked control for a free/unauthenticated user.
  const lockedFeature = page.getByRole('button', {
    name: /advanced forecasting — premium, locked/i,
  })
  await expect(lockedFeature).toBeVisible()

  // The lock badge is discoverable (FR24 — not hidden from the user).
  await expect(page.getByText('Premium', { exact: true }).first()).toBeVisible()

  // Activating the locked feature opens the upgrade prompt instead of navigating.
  // The resolved locked control now paints in the SSR HTML (story UX-1), so it is
  // clickable in the brief window before React hydrates and wires up its onClick.
  // Retry the click until the prompt opens (and stop clicking once it has) — the
  // Playwright-recommended way to act on a control that may not yet be hydrated.
  const goPremium = page.getByRole('heading', { name: /go premium/i })
  await expect(async () => {
    if (!(await goPremium.isVisible())) {
      await lockedFeature.click()
    }
    await expect(goPremium).toBeVisible({ timeout: 1000 })
  }).toPass()

  // Story 30-1: the dialog overlay must cover the whole viewport.
  //
  // `Modal` renders in normal flow — there is no `createPortal` in ui/Modal.tsx
  // — and `PremiumFeatureGate` returns a fragment of <button> PLUS the prompt.
  // So if the gate is placed directly inside the `space-y-3` stack instead of
  // its own wrapper <div>, the overlay becomes a spaced sibling, inherits
  // `margin-top: .75rem`, and (being fixed + inset-0 + height:auto) shrinks —
  // leaving a 12px undimmed strip across the top of the screen. The wrapper
  // divs in HomePage.tsx are the fix; without this assertion only a comment
  // protects them (mutation-verified during review: removing them kept the
  // whole suite green).
  const overlay = await page.locator('.fixed.inset-0').first().boundingBox()
  const viewport = page.viewportSize()
  expect(overlay, 'the upgrade dialog overlay must be measurable').not.toBeNull()
  expect(overlay?.y, 'overlay is offset from the top — a gate lost its wrapper div').toBe(0)
  expect(overlay?.height).toBe(viewport?.height)
})

const THEME_KEY = 'budget-planner-theme-prefs-v1'

/** Computed chassis styles of the three premium benefit boxes, in DOM order. */
function readBoxes(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const nodes = [
      document.querySelector('[data-testid="premium-benefit-sync"]'),
      ...document.querySelectorAll('[data-testid="premium-gate-locked"]'),
    ].filter((n): n is Element => n !== null)
    return nodes.map((n) => {
      const s = getComputedStyle(n)
      return { bg: s.backgroundColor, border: s.borderTopColor, radius: s.borderTopLeftRadius }
    })
  })
}

/**
 * Load `/` with the theme preference SEEDED, and wait until it has painted.
 *
 * Seeding the persisted store is the only reliable way to reach dark mode here.
 * `ThemeProvider` re-applies the stored preference in its mount effect and calls
 * `classList.toggle('dark', false)`, so a hand-added `.dark` class survives only
 * ~530-600ms: a test that toggles it passes purely by finishing inside that
 * window, and fails on a machine ~40% slower with "box did not repaint in dark"
 * — a styling regression that does not exist. Seeding also removes the
 * transition-interpolation race, because the page paints the target theme from
 * its first frame rather than animating into it.
 */
async function gotoWithTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    THEME_KEY,
    JSON.stringify({ state: { theme }, version: 0 }),
  ] as const)
  await page.goto('/')
  await expect(page.getByTestId('premium-benefit-sync')).toBeVisible()
  await expect(page.getByTestId('premium-gate-locked')).toHaveCount(2)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(theme === 'dark')
}

/**
 * Premium benefit boxes are theme-correct at 320px (story 30-1, AC-5/AC-6.3).
 *
 * This is the assertion that actually carries AC-5. `theme-page-coverage.spec.ts`
 * only asserts `.surface-sunken` / `.surface`, which on `/` resolve to the page
 * shell and a section wrapper — never a premium box — so it would stay green
 * whether or not this restyle is correct. Here we read the computed colours of
 * the three boxes themselves, in both themes.
 *
 * jsdom cannot do this: it computes no layout and no cascade, so the equivalent
 * unit assertion would pass vacuously.
 */
test('30-1: the three premium benefit boxes are theme-correct and fit 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })

  await gotoWithTheme(page, 'light')
  const light = await readBoxes(page)
  expect(light).toHaveLength(3)

  // AC-1: one chassis — every box agrees on border colour and radius.
  for (const box of light) {
    expect(box.border).toBe(light[0].border)
    expect(box.radius).toBe(light[0].radius)
  }

  // Nothing overflows at 320px.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    scrollWidth,
    `overview overflows at 320px: ${scrollWidth} > ${clientWidth}`
  ).toBeLessThanOrEqual(clientWidth)

  // AC-5: the dark tokens actually engage — every box repaints, background AND
  // border. Asserted against the CARD the boxes sit on rather than against the
  // string 'rgb(255, 255, 255)': the dark token is `gray-700/40`, which
  // serialises as `rgba(..., 0.4)` and so could never equal that literal — an
  // assertion that cannot fail is worse than none.
  await gotoWithTheme(page, 'dark')
  const dark = await readBoxes(page)
  expect(dark).toHaveLength(3)
  for (const [i, box] of dark.entries()) {
    expect(box.bg, `box ${i} did not repaint in dark`).not.toBe(light[i].bg)
    expect(box.border, `box ${i} border did not repaint in dark`).not.toBe(light[i].border)
    expect(box.border).toBe(dark[0].border)
  }

  const cardBg = await page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Premium Features' }) })
    .evaluate((n) => getComputedStyle(n).backgroundColor)
  expect(cardBg, 'the premium card must be dark, not a white card on a dark canvas').not.toBe(
    'rgb(255, 255, 255)'
  )
})

/**
 * The interactive affordance is real, not just present in the class list
 * (story 30-1, AC-4).
 *
 * This is the guard that catches the `hover:surface-inset` trap: that variant
 * compiles, survives lint and type-check, and satisfies any class-token
 * assertion — while resolving to the SAME colour `surface-inset` already sets,
 * so the hover does nothing. Only a real browser reading the computed colour
 * under an actual pointer hover can tell the two apart.
 */
test('30-1: only the route-backed tiles respond to hover (AC-4)', async ({ page }) => {
  await page.goto('/')

  const sync = page.getByTestId('premium-benefit-sync')
  const tile = page.getByTestId('premium-gate-locked').first()
  await expect(sync).toBeVisible()
  await expect(tile).toBeVisible()

  const bgOf = (loc: ReturnType<typeof page.getByTestId>) =>
    loc.evaluate((n) => getComputedStyle(n).backgroundColor)

  // Re-hover inside the poll. The section sits low on the page, so `hover()`
  // scrolls first; under full-suite parallel load the charts above are still
  // settling and the tile can shift out from under the cursor, leaving `:hover`
  // unapplied. A single hover outside the poll is flaky for that reason.
  const tileRest = await bgOf(tile)
  await expect
    .poll(
      async () => {
        await tile.hover()
        return bgOf(tile)
      },
      { message: 'the premium tile background must actually change on hover' }
    )
    .not.toBe(tileRest)

  // The listed sync benefit is not openable, so it must stay inert on hover.
  //
  // Asserted by SAMPLING, not by `expect.poll(...).toBe(rest)`: poll retries
  // until the assertion passes, and the first sample is taken before any hover
  // style could have applied, so it passes on iteration one no matter what.
  // Mutation-proved: giving the sync box `hover:bg-red-500` left the polled
  // version green. Persistent truth needs every sample checked, not eventual.
  const syncRest = await bgOf(sync)
  await sync.hover()
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(60)
    expect(await bgOf(sync), 'the listed sync benefit must not react to hover').toBe(syncRest)
  }
})
