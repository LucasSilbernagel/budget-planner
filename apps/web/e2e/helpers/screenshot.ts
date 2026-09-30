import type { Locator, Page } from '@playwright/test'

/**
 * Shared by the two screenshot specs (story 84.1): the clock every shot runs
 * at and how long a shot may wait for two identical frames.
 *
 * `FIXED_NOW` is the date `seedFinanceRows` stamps its rows with, so the
 * footer's copyright year and every "as of" date in a shot are fixed.
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
export function copyrightYear(page: Page): Locator[] {
  return [page.locator('footer span').filter({ hasText: /^Copyright \d{4}/ })]
}
