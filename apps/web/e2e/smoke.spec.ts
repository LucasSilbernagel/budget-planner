import { expect, test } from '@playwright/test'

test('app serves the home page', async ({ page }) => {
	const response = await page.goto('/')
	expect(response?.ok()).toBeTruthy()
	await expect(page.locator('body')).toBeVisible()
})
