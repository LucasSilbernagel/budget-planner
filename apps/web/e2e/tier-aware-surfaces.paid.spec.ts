import { type Page, expect, test } from '@playwright/test'

/**
 * The Overview and Settings premium surfaces, on a REAL paid session
 * (story 58.2, AC-9).
 *
 * ## Why this file is named `.paid.spec.ts`
 *
 * Tier is a SERVER-side fact: both gates read it from the SSR session seed, so
 * no amount of browser-side setup can produce a paid render.
 * `playwright.config.ts` runs two dev servers — the default on :5173 with no
 * override, and a second on :5174 booted with `E2E_SESSION_SEED` set to an
 * entitled session via the dev-only seam in `server/api/auth/session-seed.ts`.
 * The `chromium-paid` project matches `*.paid.spec.ts` and points `baseURL` at
 * :5174.
 *
 * ⚠️ Rename this file and it runs against the FREE server — where every element
 * asserted absent below is present, so the failures would be loud but would say
 * nothing about the code. The free-origin control at the bottom is what makes a
 * BROKEN SEAM loud instead of silent, which is the dangerous direction.
 *
 * ## ⚠️⚠️ This file is made almost entirely of ABSENCE assertions
 *
 * An empty page, a crashed render, a 404, a wrong origin and a correctly trimmed
 * page are all indistinguishable to `toHaveCount(0)`. Two rules, applied to every
 * test here:
 *
 *   1. **Every absence assertion is paired with a positive anchor in the SAME
 *      render** — `assertOverviewRendered()` / `assertSettingsRendered()` — so
 *      "nothing is there" can never be mistaken for "the page did not load".
 *   2. **The free-origin control proves the assertions can fail at all.** Without
 *      it, a seam that silently stopped delivering a paid seed would leave every
 *      test in this file passing against a page that never had the content.
 *
 * ## What this file proves, and what it does not
 *
 * It proves the shipped pages render the right SURFACES for a real entitled
 * session. It does not prove the tier predicate's fail-closed/fail-open arms —
 * that is jsdom's job in `HomePage.test.tsx`, `settings-page.test.tsx` and
 * `lib/premium/__tests__/entitlement.test.ts`, which cover null / unauthenticated
 * / past_due / canceled seeds. Neither half covers the other; do not cite one as
 * evidence for the other.
 */

/** The free server, for the negative control. Absolute: this project's baseURL is :5174. */
const FREE_ORIGIN = 'http://localhost:5173'

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

async function assertSettingsRendered(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: /^settings$/i })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: /^display$/i })).toBeVisible()
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

  test('the nav still carries all four premium destinations — the route they moved to', async ({
    page,
  }) => {
    // ⚠️ The half that makes the removal safe rather than a regression, asserted
    // in the same run: the cards are gone BECAUSE the nav carries them. If this
    // ever fails alongside the test above, a paid user has no route to these
    // pages at all — the precise stranding FR88's sequencing exists to prevent.
    await goto(page, '/')
    await assertOverviewRendered(page)

    for (const route of ['/forecasting', '/profiles', '/report', '/categories']) {
      // ⚠️ Assert the ANCHOR and its href, not just `li[data-nav-path=…]`. An
      // earlier version counted the attribute alone, which a hidden item or a
      // broken `to` with an intact `data-nav-path` would satisfy — and this is
      // the ONLY e2e evidence that removing the cards is safe rather than a
      // regression (code review, 2026-09-21).
      const link = page.locator(
        `nav[aria-label="Primary"] li[data-nav-path="${route}"] a[href="${route}"]`
      )
      await expect(link, `the nav must still reach ${route}`).toHaveCount(1)
      await expect(link, `${route} must be an attached, non-empty anchor`).not.toBeEmpty()
    }
  })
})

test.describe('the paid Settings drops the two premium sections (D2)', () => {
  test('neither section renders, and the rest of the page does', async ({ page }) => {
    await goto(page, '/settings')
    await assertSettingsRendered(page)

    // The whole <section> goes — heading and explanatory copy, not just the box.
    await expect(page.getByRole('heading', { level: 2, name: /^financial summary$/i })).toHaveCount(
      0
    )
    await expect(page.getByRole('heading', { level: 2, name: /^categories$/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /financial summary report/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /custom categories/i })).toHaveCount(0)
    await expect(page.getByText(/a printable summary of your budget/i)).toHaveCount(0)
    await expect(page.getByText(/your own income and expense groupings/i)).toHaveCount(0)

    // The sections that are NOT tier-gated stay put — a second positive anchor,
    // and the guard against a gate that accidentally swallowed its neighbours.
    await expect(page.getByRole('button', { name: /clear local data/i })).toBeVisible()
  })

  test('the report privacy sentence goes with the section and is NOT re-homed to /report', async ({
    page,
  }) => {
    // ⚠️⚠️ The trap this pins. Removing the Settings section takes away "The
    // summary is assembled in your browser — nothing is sent anywhere to produce
    // it" for a paid user, and the obvious fix is to move it onto /report —
    // exactly what story 57.1 correctly did for /forecasting. It is WRONG here:
    // story 56.1 / UX-DR62 removed that disclaimer from the report deliberately
    // and `FinancialSummaryReport.test.tsx` pins its ABSENCE. The claim survives
    // for paid users in /docs (features.md).
    await goto(page, '/settings')
    await assertSettingsRendered(page)
    await expect(page.getByText(/nothing is sent anywhere to produce it/i)).toHaveCount(0)
  })
})

/**
 * ⚠️⚠️ THE CONTROL THAT MAKES EVERY ASSERTION ABOVE MEAN SOMETHING.
 *
 * Same assertions, inverted, against the FREE server. If the dev-only seed seam
 * ever stops delivering an entitled session, these fail and the ones above keep
 * passing — which is exactly the signal needed, because absence assertions alone
 * cannot tell "correctly trimmed" from "never rendered".
 */
test.describe('negative control: the free origin still has everything', () => {
  test('the free Overview keeps the section and all five boxes', async ({ page }) => {
    await goto(page, `${FREE_ORIGIN}/`)
    await assertOverviewRendered(page)

    await expect(page.getByRole('heading', { name: PREMIUM_HEADING })).toBeVisible()
    for (const title of BENEFIT_TITLES) {
      await expect(page.getByText(title, { exact: true }), `"${title}" must render`).toHaveCount(1)
    }
    await expect(page.getByTestId('premium-gate-locked')).toHaveCount(BENEFIT_TITLES.length)
  })

  test('the free Settings keeps both premium sections and the privacy sentence', async ({
    page,
  }) => {
    await goto(page, `${FREE_ORIGIN}/settings`)
    await assertSettingsRendered(page)

    await expect(
      page.getByRole('heading', { level: 2, name: /^financial summary$/i })
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /^categories$/i })).toBeVisible()
    await expect(page.getByText(/nothing is sent anywhere to produce it/i)).toBeVisible()
  })

  test('the free nav does NOT carry the four premium destinations', async ({ page }) => {
    // Proves the two origins really are different sessions, not the same server
    // answering twice — the failure mode that would make this whole control
    // vacuous.
    await goto(page, `${FREE_ORIGIN}/`)
    await assertOverviewRendered(page)

    for (const route of ['/forecasting', '/profiles', '/report', '/categories']) {
      await expect(
        page.locator(`nav[aria-label="Primary"] li[data-nav-path="${route}"]`),
        `the FREE nav must not reach ${route}`
      ).toHaveCount(0)
    }
  })
})
