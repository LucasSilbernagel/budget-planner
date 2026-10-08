import { expect, type Page, test } from '@playwright/test'

const PAGES = [
	{
		path: '/income',
		trigger: '+ Add Income Source',
		addTitle: 'Add Income Source',
		editTitle: 'Edit Income Source',
		fields: ['income-name-input', 'income-amount-input'],
	},
	{
		path: '/expenses',
		trigger: '+ Add Expense',
		addTitle: 'Add Expense',
		editTitle: 'Edit Expense',
		fields: ['expense-name-input', 'expense-amount-input'],
	},
	{
		path: '/savings',
		trigger: '+ Add Savings Goal',
		addTitle: 'Add Savings Goal',
		editTitle: 'Edit Savings Goal',
		fields: ['savings-name-input', 'savings-target-amount-input'],
	},
	{
		path: '/balance',
		trigger: '+ Add Balance Entry',
		addTitle: 'Add Balance Entry',
		editTitle: 'Edit Balance Entry',
		fields: ['balance-name-input', 'balance-current-balance-input'],
	},
] as const

/** Retries because clicks before hydration are dropped. */
async function openDialog(page: Page, trigger: string, dialogName: string) {
	const button = page.getByRole('button', { name: trigger, exact: true })
	const dialog = page.getByRole('dialog', { name: dialogName })
	await expect(async () => {
		await button.click()
		await expect(dialog).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15000 })
	return dialog
}

async function openRowDialog(
	page: Page,
	action: string,
	role: 'dialog' | 'alertdialog',
	name: string
) {
	const dialog = page.getByRole(role, { name })
	await expect(async () => {
		await page.getByRole('button', { name: action, exact: true }).click()
		await expect(dialog).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15000 })
	return dialog
}

async function reload(page: Page) {
	await page.reload()
	await page.waitForLoadState('networkidle')
}

for (const { path, trigger, addTitle, editTitle, fields } of PAGES) {
	test(`${path}: add, edit and delete a row through the UI, each surviving a reload`, async ({
		page,
	}) => {
		// These two pages hydrate slowest under concurrent gates.
		if (path === '/income' || path === '/expenses') test.setTimeout(60_000)
		const [nameField, amountField] = fields
		await page.goto(path)
		await page.waitForLoadState('networkidle')

		const row = (name: string) => page.getByText(name, { exact: true })

		const add = await openDialog(page, trigger, addTitle)
		await add.getByTestId(nameField).fill('Lifecycle row')
		await add.getByTestId(amountField).fill('1234')
		await add.getByRole('button', { name: addTitle, exact: true }).click()
		await expect(add).toBeHidden()
		await expect(row('Lifecycle row').first()).toBeVisible()

		await reload(page)
		await expect(row('Lifecycle row').first()).toBeVisible()

		const edit = await openRowDialog(page, 'Edit Lifecycle row', 'dialog', editTitle)
		await edit.getByTestId(nameField).fill('Renamed row')
		await edit.getByRole('button', { name: 'Save Changes', exact: true }).click()
		await expect(edit).toBeHidden()

		await reload(page)
		await expect(row('Renamed row').first()).toBeVisible()
		await expect(row('Lifecycle row')).toHaveCount(0)

		const escaped = await openRowDialog(page, 'Delete Renamed row', 'alertdialog', 'Confirm Delete')
		await page.keyboard.press('Escape')
		await expect(escaped).toBeHidden()
		await expect(row('Renamed row').first()).toBeVisible()

		const backdropped = await openRowDialog(
			page,
			'Delete Renamed row',
			'alertdialog',
			'Confirm Delete'
		)
		// The 8,8 corner must be the backdrop at this viewport, not the card.
		const cornerIsOverlay = await page.evaluate(() => {
			const hit = document.elementFromPoint(8, 8)
			return hit !== null && hit.querySelector('[role="alertdialog"]') !== null
		})
		expect(cornerIsOverlay, 'the 8,8 corner is not the confirmation backdrop').toBe(true)
		await page.mouse.click(8, 8)
		await expect(backdropped).toBeHidden()
		await expect(row('Renamed row').first()).toBeVisible()

		const confirm = await openRowDialog(page, 'Delete Renamed row', 'alertdialog', 'Confirm Delete')
		await expect(confirm).toContainText('Renamed row')
		await confirm.getByTestId('delete-confirm-confirm').click()
		await expect(confirm).toBeHidden()
		await expect(row('Renamed row')).toHaveCount(0)

		await reload(page)
		await expect(row('Renamed row')).toHaveCount(0)
	})
}

test('an income row added on /income reaches the Overview total after a reload', async ({
	page,
}) => {
	await page.goto('/income')
	await page.waitForLoadState('networkidle')
	const add = await openDialog(page, '+ Add Income Source', 'Add Income Source')
	await expect(add.getByLabel(/frequency/i)).toHaveValue('monthly')
	await add.getByTestId('income-name-input').fill('Overview income')
	await add.getByTestId('income-amount-input').fill('1000')
	await add.getByRole('button', { name: 'Add Income Source', exact: true }).click()
	await expect(add).toBeHidden()

	await page.goto('/')
	await page.waitForLoadState('networkidle')
	// Monthly × 12 on the Overview's default Annually view. Anchored so that
	// 112,000.00 cannot pass; the currency symbol is free to vary.
	const total = /(^|[^\d,.])12,000\.00$/
	await expect(page.getByTestId('overview-total-income')).toHaveText(total)

	await reload(page)
	await expect(page.getByTestId('overview-total-income')).toHaveText(total)
})
