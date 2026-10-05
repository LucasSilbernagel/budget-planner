import { type Locator, type Page, expect } from '@playwright/test'

/**
 * Shared by the two screenshot specs (story 84.1): the clock every shot runs
 * at and how long a shot may wait for two identical frames.
 *
 * `FIXED_NOW` is the date `seedFinanceRows` stamps its rows with, so every date
 * the BROWSER renders is fixed. It does NOT fix the footer's copyright year,
 * which the server renders (see `copyrightYear`).
 */
export const FIXED_NOW = new Date('2026-08-11T12:00:00.000Z')

/** Recharts animates with JS for ~1.5 s, which `animations: 'disabled'` does not stop. */
export const SHOT_TIMEOUT = 15_000

/**
 * The footer's copyright year, which every shot MASKS.
 *
 * The clock can't fix it: `Footer.tsx` renders `new Date().getFullYear()` on the
 * SERVER, and `page.clock` only reaches the browser. MEASURED in story 84.1
 * Task 2: with the clock at 2031 the footer still read `Copyright 2026`. Unmasked,
 * every full-page shot would turn RED on 1 January and block the deploy.
 */
export async function copyrightYear(page: Page): Promise<Locator[]> {
  const year = page.locator('footer span').filter({ hasText: /^Copyright \d{4}/ })
  // Exactly one, asserted: a mask that matches nothing masks nothing and passes,
  // so a footer copy change would only show up on 1 January (story 84.1 review).
  await expect(year, 'the copyright-year mask matched no footer text').toHaveCount(1)
  return [year]
}

/**
 * Wait until the page has drawn exactly `count` Recharts charts.
 *
 * ⚠️ `toHaveScreenshot`'s wait for two identical frames is NOT enough. The
 * Overview's pies and bars are lazy chunks behind `Suspense`; MEASURED in story
 * 84.1 (CI run 36784606423): one capture caught every chart area BLANK, the blank
 * page stayed identical for 250 ms, so Playwright called it stable and compared
 * it (36344 pixels differed; it passed on retry). A baseline taken in that state
 * would pin blank charts forever. `count` is exact, so a chart that stops
 * loading, or an unexpected one, fails here with a message, not as a pixel diff.
 */
export async function chartsDrawn(page: Page, count: number): Promise<void> {
  await expect(page.locator('.recharts-surface')).toHaveCount(count, { timeout: SHOT_TIMEOUT })
}

/** 44 x 44 CSS px, decided for phone targets in story 96.1 (FR156, D1). */
export const PHONE_TARGET_PX = 44

/**
 * The phone top strip's height (story 96.1, D2): 44px of content plus its 1px
 * bottom border. Pinned outright in each state, never as an equality between
 * two states (an equality cannot catch both drifting together).
 */
export const PHONE_STRIP_PX = 45

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Assert a control's rendered box is at least `min` CSS px (story 96.1). jsdom
 * cannot measure this (no Tailwind loads in the unit suite), so it runs in the
 * screenshot tests, before the shot.
 *
 * `toHaveCount(1)` FIRST: `toBeVisible()`/`boundingBox()` on a locator that
 * matches nothing is the vacuous shape story 96.3's review measured.
 * `sides: 'height'` is for full-width rows and inline links, where the width is
 * not the claim.
 */
export async function expectTarget(
  locator: Locator,
  label: string,
  { min = PHONE_TARGET_PX, sides = 'both' }: { min?: number; sides?: 'both' | 'height' } = {}
): Promise<Box> {
  await expect(locator, `${label}: expected exactly one match`).toHaveCount(1)
  await expect(locator, `${label}: not visible`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${label}: no layout box`).not.toBeNull()
  const b = box as Box
  expect(b.height, `${label} is ${b.height}px tall, under ${min}`).toBeGreaterThanOrEqual(min)
  if (sides === 'both') {
    expect(b.width, `${label} is ${b.width}px wide, under ${min}`).toBeGreaterThanOrEqual(min)
  }
  return b
}

/**
 * The phone top strip (`[data-auth-indicator]`) is exactly `PHONE_STRIP_PX`
 * tall and the page does not scroll sideways at `width` (story 96.1, AC 1-2).
 */
export async function expectPhoneStrip(page: Page, width: number): Promise<void> {
  const strip = page.locator('[data-auth-indicator]')
  await expect(strip).toHaveCount(1)
  const box = await strip.boundingBox()
  expect(box?.height, 'the phone top strip height').toBe(PHONE_STRIP_PX)
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(width)
}

/**
 * Every VISIBLE bottom-bar cell (tab links + the More `<summary>`) is a
 * 44 x 44px target (story 96.1, AC 4). Cells hidden at this width are skipped,
 * and the visible count is asserted so an empty sweep cannot pass.
 */
export async function expectBarCells(page: Page, expectedVisible: number): Promise<void> {
  const cells = page.locator(
    'nav[aria-label="Primary"] > ul > li > a, nav[aria-label="Primary"] > ul > li > details > summary'
  )
  let visible = 0
  for (const cell of await cells.all()) {
    if (!(await cell.isVisible())) continue
    visible += 1
    const name = ((await cell.textContent()) ?? '').trim()
    await expectTarget(cell, `bar cell "${name}"`)
  }
  expect(visible, 'visible bottom-bar cells').toBe(expectedVisible)
}
