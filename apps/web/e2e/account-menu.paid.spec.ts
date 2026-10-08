import { expect, test } from '@playwright/test'
import { accountTrigger, openAccountMenu, SESSION_SETTLE_MS } from './helpers/account-menu'
import { mockSessionThatCanEnd } from './helpers/nav-more'

// Only the chromium-paid project runs `.paid.spec.ts` files; renaming this one
// silently tests the free chrome instead.

test('a signed-in user signs out from the paid chrome too, at 2400px', async ({ page }) => {
	await page.setViewportSize({ width: 2400, height: 900 })
	let logoutPosts = 0
	const session = await mockSessionThatCanEnd(page, { subscriptionStatus: 'active' })
	await page.route('**/api/auth/logout', async (route) => {
		if (route.request().method() === 'POST') logoutPosts += 1
		session.signedOut = true
		await route.fulfill({ json: { success: true } })
	})
	await page.goto('/financial-summary')
	// Anchor on the page: the 404 carries the same chrome, so the sign-out would
	// also pass on a stale path.
	await expect(
		page.getByRole('heading', { level: 1, name: 'Financial Summary', exact: true })
	).toBeVisible()
	const panel = await openAccountMenu(page, { acrossHydration: true })
	await panel.getByRole('button', { name: 'Sign out' }).click()

	await expect(page).toHaveURL(/\/$/)
	// The SSR seed is signed in, so the reload repaints the trigger; it goes only
	// once the post-mount session fetch reports signed-out.
	await expect(accountTrigger(page)).toHaveCount(0, { timeout: SESSION_SETTLE_MS })
	expect(logoutPosts, 'expected exactly one logout POST').toBe(1)
})
