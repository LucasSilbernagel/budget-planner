import { expect, type Page, test } from '@playwright/test'
import { mockSignedIn } from './helpers/nav-more'

// Only chromium-paid runs `.paid.spec.ts`: tier comes from the SSR seed, so no browser
// setup can produce a paid render.

// Mostly absence assertions: each is paired with a positive anchor in the same render,
// and each would fail against the free Overview.

const PREMIUM_HEADING = 'Premium Features'

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

/** Built from elements outside the premium surfaces, so it holds in both tiers. */
async function assertOverviewRendered(page: Page): Promise<void> {
	await expect(page.getByText('Track your finances with privacy and control')).toBeVisible()
	await expect(page.locator('nav[aria-label="Primary"]')).toBeVisible()
}

test.describe('the paid Overview drops the Premium Features section (D1)', () => {
	test('no heading, no boxes, and the page is demonstrably rendered', async ({ page }) => {
		// The paid seam's SSR seed is entitled but its real /api/auth/me answers
		// signed-out, and the Overview follows that answer, so mock an agreeing one.
		await mockSignedIn(page, { subscriptionStatus: 'active' })
		await goto(page, '/')
		await assertOverviewRendered(page)

		await expect(page.getByRole('heading', { name: PREMIUM_HEADING })).toHaveCount(0)

		// Per benefit, not a count: a count passes with the wrong subset surviving.
		for (const title of BENEFIT_TITLES) {
			await expect(
				page.getByText(title, { exact: true }),
				`"${title}" must not render`
			).toHaveCount(0)
		}

		await expect(page.getByTestId('premium-gate-locked')).toHaveCount(0)
		await expect(page.getByTestId('premium-gate-skeleton')).toHaveCount(0)
		await expect(page.getByTestId('premium-benefit-sync')).toHaveCount(0)
	})
})
