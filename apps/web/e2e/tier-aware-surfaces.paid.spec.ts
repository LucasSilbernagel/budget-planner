import { type Page, expect, test } from '@playwright/test'

/**
 * The Overview premium surface, on a REAL paid session (story 58.2, AC-9).
 *
 * ## Why this file is named `.paid.spec.ts`
 *
 * Tier is a SERVER-side fact: the gate reads it from the SSR session seed, so
 * no amount of browser-side setup can produce a paid render.
 * `playwright.config.ts` runs two dev servers — the default on :5173 with no
 * override, and a second on :5174 booted with `E2E_SESSION_SEED` set to an
 * entitled session via the dev-only seam in `server/api/auth/session-seed.ts`.
 * The `chromium-paid` project matches `*.paid.spec.ts` and points `baseURL` at
 * :5174.
 *
 * ⚠️ Rename this file and it runs against the FREE server — where every element
 * asserted absent below is present, so the failures would be loud but would say
 * nothing about the code.
 *
 * ⚠️ Since story 84.5 (FR137) this file holds ONE test, flow F5's paid Overview.
 * The nav, Settings and free-origin tests moved below the browser
 * (`GlobalNav.test.tsx`, `settings-page.test.tsx`, `HomePage.test.tsx`; list in
 * `_bmad-output/implementation-artifacts/84-5-evidence/inventory.md`). The
 * free-origin CONTROL went with them, and that is safe in the dangerous
 * direction: if the seam stops delivering a paid seed, this page renders the
 * free Overview, whose "Premium Features" heading turns the test below RED.
 *
 * ## ⚠️⚠️ This file is made almost entirely of ABSENCE assertions
 *
 * An empty page, a crashed render, a 404, a wrong origin and a correctly trimmed
 * page are all indistinguishable to `toHaveCount(0)`. Two rules:
 *
 *   1. **Every absence assertion is paired with a positive anchor in the SAME
 *      render** — `assertOverviewRendered()` — so
 *      "nothing is there" can never be mistaken for "the page did not load".
 *   2. **The assertions can fail against a free render**: the free Overview
 *      carries every element asserted absent below (pinned per tier state in
 *      `HomePage.test.tsx`).
 *
 * ## What this file proves, and what it does not
 *
 * It proves the shipped Overview renders the right SURFACE for a real entitled
 * session. It does not prove the tier predicate's fail-closed/fail-open arms —
 * that is jsdom's job in `HomePage.test.tsx`, `settings-page.test.tsx` and
 * `lib/premium/__tests__/entitlement.test.ts`, which cover null / unauthenticated
 * / past_due / canceled seeds. Neither half covers the other; do not cite one as
 * evidence for the other.
 */

const PREMIUM_HEADING = 'Premium Features'

/** Every Overview benefit box's visible title (`OVERVIEW_BENEFITS`, canonical order). */
const BENEFIT_TITLES = [
  'Advanced Forecasting',
  'Financial summary report',
  'Custom Profiles',
  'Custom categories',
  'Multi-device sync',
] as const

async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
}

/**
 * The positive anchor every absence assertion in this file leans on. Deliberately
 * made of elements OUTSIDE the premium surfaces, so it stays true in both tiers
 * and proves only one thing: this page really rendered.
 */
async function assertOverviewRendered(page: Page): Promise<void> {
  await expect(page.getByText('Track your finances with privacy and control')).toBeVisible()
  await expect(page.locator('nav[aria-label="Primary"]')).toBeVisible()
}

test.describe('the paid Overview drops the Premium Features section (D1)', () => {
  test('no heading, no boxes, and the page is demonstrably rendered', async ({ page }) => {
    await goto(page, '/')
    await assertOverviewRendered(page)

    await expect(page.getByRole('heading', { name: PREMIUM_HEADING })).toHaveCount(0)

    // Per benefit, not a count. A count-only assertion passes against the wrong
    // subset surviving — the defect shape FR88 itself names.
    for (const title of BENEFIT_TITLES) {
      await expect(
        page.getByText(title, { exact: true }),
        `"${title}" must not render`
      ).toHaveCount(0)
    }

    // None of the gate's three render states may appear either.
    await expect(page.getByTestId('premium-gate-locked')).toHaveCount(0)
    await expect(page.getByTestId('premium-gate-skeleton')).toHaveCount(0)
    await expect(page.getByTestId('premium-benefit-sync')).toHaveCount(0)
  })
})
