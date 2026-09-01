import { type Locator, type Page, expect, test } from '@playwright/test'
import { FINANCE_THEME_KEY, LONG_UNBROKEN_NAME, seedFinanceRows } from './helpers/seed-finance-rows'

/**
 * Horizontal-scroll affordance on the finance tables (story 42.2, UX-DR46).
 *
 * ## The band, and why it is not 320px
 *
 * 640-1024px. Below `sm` the rows are cards (UX-DR36) and nothing scrolls; at
 * 1280px there is slack. `deferred-work.md:936-942` records a guard that ran at
 * 320 and 1280 only — "the two widths where the documented overflow cannot
 * occur" — and so was assertion-shaped while being structurally unable to fire.
 * Everything here runs at 768px.
 *
 * ## Why pixels, and why this shape of pixel test
 *
 * The affordance is four CSS background layers with no state: two covers in the
 * surface colour painted `local` (they travel with the content) and two shadows
 * painted `scroll` (pinned to the box). `getComputedStyle` returns the SAME
 * declared value whether the table fits or overflows and whatever the scroll
 * position — only the painted result differs. So a computed-style assertion
 * here would be a tautology over the constant the implementation just wrote,
 * and could not fail. These tests sample real pixels.
 *
 * ⚠️ They are DIFFERENTIAL, not "is there a dark pixel". At `scrollLeft = 0` the
 * left cover sits exactly over the left shadow, so the LEFT edge must read as
 * surface while the RIGHT edge must not; scrolled to the end it is the mirror
 * image. That is the mechanism itself, so a shadow that is merely permanently
 * painted (the AC-6 defect) fails these just as hard as a missing one.
 *
 * ## Where it is safe to sample
 *
 * Background layers paint BEHIND cell content, so a strip that crosses text
 * would measure the text. The outer edges do not: at 768px the first and last
 * cells carry `max-lg:px-4`, so the outermost ~16px of the wrapper is cell
 * padding on every row. We sample x = 2 and x = width - 3, take the MEDIAN down
 * a band of rows (immune to the 1px `divide-y` rules), and skip the top of the
 * box because the `<thead>` is opaque `surface-inset`.
 *
 * ⚠️ CI font. Widths here are measured under DejaVu Sans, which is what the
 * runner resolves `system-ui` to; a dev box resolves the narrower Noto Sans and
 * a green local run is not evidence about a width budget
 * (`ResponsiveTable.tsx`, the `max-lg:px-4` block). Re-declared per spec on
 * purpose — `premium-locked.spec.ts:280-281`.
 *
 * ⚠️ The last test is a POSITIVE CONTROL. Without it a green file proves only
 * that the assertions ran.
 */

const WIDE_FONT = '*,*::before,*::after{font-family:"DejaVu Sans"!important}'

const SURFACE_LIGHT = { r: 255, g: 255, b: 255 }
const SURFACE_DARK = { r: 31, g: 41, b: 55 }

/** Max per-channel distance from the surface colour that still reads as "no affordance".
 *  The `divide-y` rule (gray-200) is 26 away, so this sits below it and the median
 *  down the band removes it anyway; the shadow's own edge stop is ~46 away in light. */
const SURFACE_TOLERANCE = 12
/** Distance that counts as "the shadow is painted here". Above the divider's 26. */
const SHADOW_MIN_DELTA = 30

type Rgb = { r: number; g: number; b: number }

const delta = (a: Rgb, b: Rgb): number =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))

/**
 * Median colour of a vertical strip inside the wrapper, decoded from a real
 * screenshot. Decoding happens in the PAGE (canvas + a data URL) so this needs
 * no image library and no visual-regression baseline.
 */
async function edgeColour(page: Page, wrapper: Locator, edge: 'left' | 'right'): Promise<Rgb> {
  // Skip the opaque <thead> by MEASURING it, not by guessing a fraction. On the
  // single-row "fits" fixture the header is 40% of the box, and a fixed 45%
  // start left five points of clearance — enough that a slightly taller header
  // would have made the probe sample `surface-inset` and report a false colour.
  const headerFraction = await wrapper.evaluate((el) => {
    const box = el.getBoundingClientRect().height
    const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 0
    return box > 0 ? head / box : 0
  })
  const png = await wrapper.screenshot()
  return page.evaluate(
    async ([b64, which, skip]) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.drawImage(img, 0, 0)

      const x = which === 'left' ? 2 : img.width - 3
      // Start below the measured header plus a 4px guard band.
      const yFrom = Math.min(Math.floor(img.height * skip) + 4, img.height - 2)
      const yTo = Math.floor(img.height * 0.95)
      const rs: number[] = []
      const gs: number[] = []
      const bs: number[] = []
      for (let y = yFrom; y < yTo; y++) {
        const d = ctx.getImageData(x, y, 1, 1).data
        rs.push(d[0])
        gs.push(d[1])
        bs.push(d[2])
      }
      const median = (xs: number[]) => xs.sort((p, q) => p - q)[Math.floor(xs.length / 2)]
      return { r: median(rs), g: median(gs), b: median(bs) }
    },
    [png.toString('base64'), edge, headerFraction] as const
  )
}

function wrapperOf(page: Page): Locator {
  return page
    .locator('div.overflow-x-auto')
    .filter({ has: page.locator('table') })
    .first()
}

async function metrics(wrapper: Locator) {
  return wrapper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollLeft: el.scrollLeft,
  }))
}

/** A single short row per store: the table fits its wrapper with room to spare. */
function seedShortRows([theme, themeKey]: readonly ['light' | 'dark', string]): void {
  const now = '2026-08-11T00:00:00.000Z'
  const flow = (id: string, name: string, amount: number) => ({
    id,
    userId: 0,
    name,
    amount,
    frequency: 'monthly',
    categoryId: null,
    createdAt: now,
    updatedAt: now,
  })
  localStorage.setItem(
    'budget-planner-income-v1',
    JSON.stringify({ state: { incomeSources: [flow('i1', 'Pay', 100000)] }, version: 2 })
  )
  localStorage.setItem(
    'budget-planner-expenses-v1',
    JSON.stringify({ state: { expenses: [flow('e1', 'Rent', 90000)] }, version: 2 })
  )
  localStorage.setItem(
    'budget-planner-currency-prefs-v1',
    JSON.stringify({ state: { mode: 'symbol', currency: 'USD' }, version: 2 })
  )
  localStorage.setItem(themeKey, JSON.stringify({ state: { theme }, version: 0 }))
}

const OVERFLOW_ROUTES = ['/income', '/expenses', '/savings', '/balance'] as const

// ---------------------------------------------------------------------------
// AC-1 / AC-3 — an overflowing table is signposted, before any interaction.
// ---------------------------------------------------------------------------

for (const route of OVERFLOW_ROUTES) {
  test(`${route} signposts horizontal overflow at 768px (AC-1)`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await seedFinanceRows(page, 'light')
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: WIDE_FONT })
    await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

    const wrapper = wrapperOf(page)
    const m = await metrics(wrapper)

    // Precondition, asserted separately so a fixture that stopped overflowing
    // reddens HERE rather than silently making the affordance claim vacuous.
    expect(
      m.scrollWidth,
      `${route} fixture no longer overflows at 768px — the affordance claim below would be vacuous`
    ).toBeGreaterThan(m.clientWidth)
    expect(m.scrollLeft, 'the page must be measured unscrolled').toBe(0)

    const right = await edgeColour(page, wrapper, 'right')
    const left = await edgeColour(page, wrapper, 'left')

    expect(
      delta(right, SURFACE_LIGHT),
      `${route}: no affordance on the right edge — ${JSON.stringify(right)} reads as surface, so ${
        m.scrollWidth - m.clientWidth
      }px of table is hidden with nothing saying so`
    ).toBeGreaterThanOrEqual(SHADOW_MIN_DELTA)

    // The mirror half: unscrolled, the LEFT cover masks the left shadow. A
    // permanently-painted shadow (the AC-6 defect) fails here.
    expect(
      delta(left, SURFACE_LIGHT),
      `${route}: the left edge is shadowed at scrollLeft=0 — the cover layer is not masking, so the affordance is permanent rather than responsive`
    ).toBeLessThanOrEqual(SURFACE_TOLERANCE)
  })
}

// ⚠️ THE DARK PRESENCE CASE IS NOT OPTIONAL, AND ITS ABSENCE HID A REAL DEFECT.
// Until code review, every PRESENCE assertion ran light-only and the sole dark
// test asserted ABSENCE — so a dark affordance that never painted would have
// passed the whole file. It nearly did: the original dark shadow was
// `rgba(0,0,0,0.55)`, which over gray-800 reaches 18 against a surface of 31.
// A delta of 13 is invisible, and no test could see it. The dark shadow is a
// light glow for that reason; this case is what holds it there.
test('an overflowing table signposts in DARK mode too (AC-1)', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 })
  await seedFinanceRows(page, 'dark')
  await page.goto('/income')
  await page.waitForLoadState('networkidle')
  await page.addStyleTag({ content: WIDE_FONT })
  await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(true)

  const wrapper = wrapperOf(page)
  const m = await metrics(wrapper)
  expect(m.scrollWidth, 'dark fixture does not overflow').toBeGreaterThan(m.clientWidth)

  const right = await edgeColour(page, wrapper, 'right')
  const left = await edgeColour(page, wrapper, 'left')
  expect(
    delta(right, SURFACE_DARK),
    `dark: no affordance on the right edge — ${JSON.stringify(
      right
    )} against surface ${JSON.stringify(
      SURFACE_DARK
    )}. A black shadow has no headroom on a dark card; this must be a light glow.`
  ).toBeGreaterThanOrEqual(SHADOW_MIN_DELTA)
  expect(
    delta(left, SURFACE_DARK),
    'dark: the left edge is shadowed at scrollLeft=0 — the cover is not masking'
  ).toBeLessThanOrEqual(SURFACE_TOLERANCE)
})

test('the affordance follows the scroll position, not merely the presence of overflow (AC-1)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 })
  await seedFinanceRows(page, 'light')
  await page.goto('/income')
  await page.waitForLoadState('networkidle')
  await page.addStyleTag({ content: WIDE_FONT })
  await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

  const wrapper = wrapperOf(page)
  await wrapper.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
  })
  await expect.poll(() => wrapper.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)

  const left = await edgeColour(page, wrapper, 'left')
  const right = await edgeColour(page, wrapper, 'right')

  expect(
    delta(left, SURFACE_LIGHT),
    'scrolled to the end, the LEFT shadow must appear — content is now hidden to the left'
  ).toBeGreaterThanOrEqual(SHADOW_MIN_DELTA)
  expect(
    delta(right, SURFACE_LIGHT),
    'scrolled to the end, the RIGHT shadow must be masked — there is nothing further right'
  ).toBeLessThanOrEqual(SURFACE_TOLERANCE)
})

// ---------------------------------------------------------------------------
// AC-6 — a table that FITS paints nothing, in both themes.
// ---------------------------------------------------------------------------

for (const theme of ['light', 'dark'] as const) {
  test(`a table that fits paints no affordance (${theme}) (AC-6)`, async ({ page }) => {
    const surface = theme === 'dark' ? SURFACE_DARK : SURFACE_LIGHT
    await page.setViewportSize({ width: 768, height: 900 })
    await page.addInitScript(seedShortRows, [theme, FINANCE_THEME_KEY] as const)
    await page.goto('/income')
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: WIDE_FONT })
    await expect(page.getByText('Pay').first()).toBeVisible()

    // The theme actually took. `emulateMedia({colorScheme})` would be a no-op —
    // this app reads a `.dark` class, never `prefers-color-scheme`
    // (`nav-planner-visibility.spec.ts:206-225` records a story proving its dark
    // half by nothing that way). The store is seeded, so ThemeProvider cannot
    // strip it back on mount.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(theme === 'dark')

    const wrapper = wrapperOf(page)
    const m = await metrics(wrapper)
    expect(
      m.scrollWidth,
      `the "fits" fixture overflows (${m.scrollWidth} > ${m.clientWidth}) — AC-6 would be tested against the wrong case`
    ).toBeLessThanOrEqual(m.clientWidth)

    for (const edge of ['left', 'right'] as const) {
      const c = await edgeColour(page, wrapper, edge)
      expect(
        delta(c, surface),
        `${theme}: the ${edge} edge paints an affordance on a table that fits — ${JSON.stringify(
          c
        )} vs surface ${JSON.stringify(
          surface
        )}. A permanent shadow on a table with nothing to scroll is a new visual defect.`
      ).toBeLessThanOrEqual(SURFACE_TOLERANCE)
    }
  })
}

// ---------------------------------------------------------------------------
// AC-5 — the scroll region is operable without a pointer.
// ---------------------------------------------------------------------------

for (const route of OVERFLOW_ROUTES) {
  test(`${route} scroll region is keyboard-reachable and scrolls (AC-5)`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await seedFinanceRows(page, 'light')
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: WIDE_FONT })
    await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

    const wrapper = wrapperOf(page)
    // Precondition: without overflow there is nothing to scroll, and the
    // ArrowRight assertion below would fail saying "unreachable without a
    // pointer" when the truth is "nothing to reach".
    const pre = await metrics(wrapper)
    expect(
      pre.scrollWidth,
      `${route} fixture does not overflow — the keyboard claim would be vacuous`
    ).toBeGreaterThan(pre.clientWidth)
    await expect(wrapper).toHaveAttribute('tabindex', '0')
    await expect(wrapper).toHaveAttribute('role', 'region')
    await expect(wrapper).toHaveAccessibleName(/\S/)

    // Reachability is proven by focusing and DRIVING it, never by
    // `toBeVisible()` — Playwright's actionability auto-scroll and unclipped
    // getBoundingClientRect both mask real failures here
    // (`ux-evaluation-mobile-nav-2026-08-13.md:185-187`).
    await wrapper.focus()
    await expect(wrapper).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => wrapper.evaluate((el) => el.scrollLeft), {
        message: `${route}: the focused scroll region did not move on ArrowRight — the Actions column is unreachable without a pointer`,
      })
      .toBeGreaterThan(0)
  })
}

// ---------------------------------------------------------------------------
// AC-8 — the affordance costs no layout width.
// ---------------------------------------------------------------------------

/**
 * Measured at 768px, DejaVu Sans (`WIDE_FONT`, injected below), the shared
 * `seedFinanceRows` fixture, at commit `09f6c7c` + story 48.2's working tree.
 * Reproduce with: `pnpm exec playwright test table-scroll-affordance.spec.ts`
 * from `apps/web`. ⚠️ Name the commit — the previous baseline did (`4f5c935`)
 * and the first version of THIS comment dropped it while telling the next
 * reader to "say why" (48.2 review).
 *
 * ⚠️ RE-BASELINED BY STORY 48.2 (2026-08-31), −48px on every route. The original
 * figures were measured at `4f5c935` (pre-affordance) and were 1545 / 1536 / 1908
 * / 1994. Story 48.2 deleted the two per-row move chevrons, and the actions column
 * gave back exactly what they cost: 2 x 16px icon + 2 x 8px `sm:mr-2` = 48px,
 * host-independent. All four routes moved by that identical amount, which is what
 * makes this a re-baseline rather than a regression — a layout defect would not
 * shift four independently-built tables by the same 48px.
 *
 * The arithmetic closes against the epic-34 record: 34.1b ADDED 48px here and
 * broke `categories-premium.spec.ts`'s 768px budget (658 + 48 = 706 vs a 680
 * limit) on the CI font while passing on a narrower dev font. 48.2 returns it.
 *
 * ⚠️ THIS IS AN EQUALITY AND MUST STAY ONE. The failure message below is right:
 * do not convert it to a tolerance. Re-measure and update these numbers when a
 * change legitimately moves the width, and say why — as here.
 *
 * ⚠️ SECOND RE-BASELINE, story 49.1 (FR75), and this one moved ONE route only.
 * Deleting the "Max Contribution" and "Remaining Room" columns took `/balance`
 * from 1946 to 1660 — **-286px** — while `/income`, `/expenses` and `/savings`
 * measured byte-identical to their previous baselines. That asymmetry is the
 * evidence this is a re-baseline and not a regression: 48.2's change touched a
 * shared actions column and moved all four routes by the same 48px; 49.1 touched
 * two columns that exist on exactly one route, so exactly one number moves.
 *
 * ⚠️ The overflow PRECONDITIONS in AC-1 and AC-5 were the real risk here, not this
 * equality — `/balance` losing two wide currency columns could in principle have
 * stopped it overflowing at 768px and made those guards vacuous. Measured: 1660
 * against a 656px client width, so it still overflows by 1004px and the fixture
 * needed no widening. Checked rather than assumed.
 */
const BASELINE_SCROLL_WIDTH: Record<(typeof OVERFLOW_ROUTES)[number], number> = {
  '/income': 1497,
  '/expenses': 1488,
  '/savings': 1860,
  // Story 49.1: 1946 -> 1660 (-286px), the two deleted contribution-limit columns.
  '/balance': 1660,
}

for (const route of OVERFLOW_ROUTES) {
  test(`${route} affordance costs zero layout width at 768px (AC-8)`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 })
    await seedFinanceRows(page, 'light')
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    await page.addStyleTag({ content: WIDE_FONT })
    await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

    const m = await metrics(wrapperOf(page))
    // Backgrounds do not affect box size, so this is an EQUALITY, not a budget.
    // The free-tier table sits at 656/656 on this font: anything that reserves
    // width flips it to overflowing on the runner while passing on a dev box.
    expect(
      m.scrollWidth,
      `${route} table width moved (${BASELINE_SCROLL_WIDTH[route]} -> measured). If this story's affordance is unchanged, the cause is elsewhere: a column, label, currency format or page-shell padding edit. Backgrounds cost no width, so re-measure before assuming the shadow is at fault — but do NOT relax this to a tolerance, because the 640-1024px budget has none.`
    ).toBe(BASELINE_SCROLL_WIDTH[route])
    expect(m.clientWidth, `${route} wrapper client width moved`).toBe(656)
  })
}

// ---------------------------------------------------------------------------
// POSITIVE CONTROL
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: the pixel probe reports surface when the affordance is removed', async ({
  page,
}) => {
  // ⚠️ Without this, every "affordance is painted" assertion above could be
  // reading a dark pixel that has nothing to do with the shadow layers. Strip
  // the background off the live element and confirm the SAME probe, at the SAME
  // edge, on the SAME overflowing fixture, now reports surface.
  //
  // ⚠️ READ THE OUTCOME THE RIGHT WAY ROUND: this test passing IS the healthy
  // state — it means removing the background layers changed what the probe
  // reads, so the probe is measuring them. If it ever goes RED (or its
  // precondition fails) while the AC-1 tests still pass, the probe is reading
  // something incidental — cell text, a border, the scrollbar — and every
  // affordance assertion in this file is worthless.
  await page.setViewportSize({ width: 768, height: 900 })
  await seedFinanceRows(page, 'light')
  await page.goto('/income')
  await page.waitForLoadState('networkidle')
  await page.addStyleTag({ content: WIDE_FONT })
  await expect(page.getByText(LONG_UNBROKEN_NAME).first()).toBeVisible()

  const wrapper = wrapperOf(page)
  const before = await edgeColour(page, wrapper, 'right')
  expect(
    delta(before, SURFACE_LIGHT),
    'precondition: the affordance must be painted before we remove it'
  ).toBeGreaterThanOrEqual(SHADOW_MIN_DELTA)

  await wrapper.evaluate((el) => {
    ;(el as HTMLElement).style.backgroundImage = 'none'
  })
  const after = await edgeColour(page, wrapper, 'right')

  expect(
    delta(after, SURFACE_LIGHT),
    'the probe still reports an affordance after the background layers were removed — it is measuring something else (cell content, a border, the scrollbar), and every assertion above is worthless'
  ).toBeLessThanOrEqual(SURFACE_TOLERANCE)
})
