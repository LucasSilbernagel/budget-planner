import { expect, type Page, test } from '@playwright/test'

// Only a real reload (fresh JS context, storage the sole carrier) tells persistence from
// a component that was never unmounted. Every asserted value differs from its default.

/** Income rows, so the desired-income prefill is live. */
async function seedIncome(page: Page): Promise<void> {
	await page.addInitScript(() => {
		localStorage.setItem(
			'budget-planner-income-v1',
			JSON.stringify({
				state: {
					incomeSources: [
						{
							id: 'inc-1',
							userId: 0,
							name: 'Salary',
							amount: 200000,
							frequency: 'monthly',
							categoryId: null,
							createdAt: '2026-08-28T00:01:00.000Z',
							updatedAt: '2026-08-28T00:01:00.000Z',
						},
					],
				},
				version: 3,
			})
		)
	})
}

const AGE = '#currentAge'
const LIFE = '#lifeExpectancy'
const INCOME = '#desiredIncome'
const RATE = '#annualReturn'
const POST_RATE = '#postRetirementReturn'

/**
 * Without this hydration gate, typing lands on server markup React hasn't claimed: the
 * DOM changes, the store doesn't. `__reactEvents` appears once React binds listeners.
 */
async function gotoPlanner(page: Page): Promise<void> {
	await page.goto('/retirement')
	await page.waitForFunction(() => {
		const el = document.querySelector('#currentAge')
		return !!el && Object.keys(el).some((key) => key.startsWith('__reactEvents'))
	})
}

/**
 * `fill()` doesn't reach React on these number inputs (the DOM changes, state doesn't);
 * `pressSequentially` does. Clearing with `fill('')` is fine.
 */
async function setField(page: Page, selector: string, value: string): Promise<void> {
	await page.locator(selector).fill('')
	await page.locator(selector).pressSequentially(value, { delay: 20 })
}

test.describe('retirement plan persistence', () => {
	test('every entered value survives a reload', async ({ page }) => {
		await seedIncome(page)
		await gotoPlanner(page)

		await setField(page, AGE, '42')
		await setField(page, LIFE, '88')
		await setField(page, INCOME, '55000')
		await setField(page, RATE, '7.5')
		await setField(page, POST_RATE, '3.25')
		await page.getByRole('radio', { name: /perpetual/i }).click()

		await page.reload()

		await expect(page.locator(AGE)).toHaveValue('42')
		await expect(page.locator(LIFE)).toHaveValue('88')
		// Asserted with income seeded: without the `desiredIncomeTouched` guard the prefill
		// overwrites this field once the income store rehydrates.
		await expect(page.locator(INCOME)).toHaveValue('55,000.00')
		await expect(page.locator(RATE)).toHaveValue('7.5')
		await expect(page.locator(POST_RATE)).toHaveValue('3.25')
		await expect(page.getByRole('radio', { name: /perpetual/i })).toBeChecked()
	})
})
