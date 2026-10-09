import { type BrowserContext, expect, type Page } from '@playwright/test'
import { SESSION_SETTLE_MS } from './account-menu'
import { readOutbox } from './db-harness'

export type SignInResult = {
	linksFor: () => number
	before: number
}

export async function signInWithEmailedLink(
	page: Page,
	context: BrowserContext,
	email: string,
	{ firstStep, who }: { firstStep: number; who: string }
): Promise<SignInResult> {
	const step = (offset: number) => `step ${firstStep + offset}`
	const linksFor = () => readOutbox().filter((entry) => entry.to === email).length
	const before = linksFor()

	// Wait for React to claim the server-rendered form: typed before hydration, the
	// value is reset and the submit is lost.
	await page.waitForFunction(() => {
		const input = document.querySelector('input[type="email"]')
		return !!input && Object.keys(input).some((key) => key.startsWith('__reactEvents'))
	})
	await page.getByLabel('Email address').fill(email)
	await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
	await expect(
		page.getByRole('status').filter({ hasText: 'Check your email' }),
		`${step(0)}: the request form never confirmed the request`
	).toBeVisible()

	// The send is fire-and-forget after the response (no timing enumeration), so poll.
	await expect
		.poll(() => linksFor() - before, {
			message: `${step(1)}: no sign-in link reached the mail outbox for ${who}`,
			timeout: 15_000,
		})
		.toBeGreaterThan(0)
	const fresh = readOutbox()
		.filter((entry) => entry.to === email)
		.slice(before)
	expect(fresh, `${step(1)}: the outbox holds exactly one link for this request`).toHaveLength(1)
	const link = new URL(fresh[0]?.link ?? '')
	expect(link.pathname, `${step(1)}: the emailed link is the verify route`).toBe(
		'/api/auth/login/verify'
	)

	// Steps 3-4 are page loads on a possibly cold dev server: use the settle budget.
	await page.goto(link.toString())
	await expect(
		page.getByText(`You're about to sign in as ${email}.`),
		`${step(2)}: the link did not open the confirm interstitial (token rejected on GET?)`
	).toBeVisible({ timeout: SESSION_SETTLE_MS })
	expect(
		(await context.cookies()).some((cookie) => cookie.name === 'session'),
		`${step(2)}: opening the link must not sign in before the confirm`
	).toBe(false)

	await page.getByRole('button', { name: 'Sign in to this account' }).click()
	await expect(
		page,
		`${step(3)}: confirming did not sign in (redirected to the invalid-or-expired page?)`
	).toHaveURL(/^https?:\/\/[^/?#]+\/$/, { timeout: SESSION_SETTLE_MS })

	return { linksFor, before }
}
