import { expect, type Locator, type Page, test } from '@playwright/test'
import { accountTrigger, expectSignedInAs, openAccountMenu } from './helpers/account-menu'
import { mockSignedIn, openMore } from './helpers/nav-more'
import {
	type Box,
	chartsDrawn,
	copyrightYear,
	expectBarCells,
	expectPhoneStrip,
	expectTarget,
	FIXED_NOW,
	SHOT_TIMEOUT,
} from './helpers/screenshot'
import { seedFinanceRows } from './helpers/seed-finance-rows'

// Baselines are made in CI only: CI renders system-ui as DejaVu Sans, a dev box as
// Noto Sans. Regenerate them with the screenshots.yml workflow.

interface Shot {
	name: string
	path: string
	width: number
	height?: number
	dark?: boolean
	charts: number
	seed?: boolean
}

const PAGE_SHOTS: Shot[] = [
	{ name: 'overview-320-light', path: '/', width: 320, charts: 4 },
	{ name: 'overview-320-dark', path: '/', width: 320, dark: true, charts: 4 },
	{ name: 'overview-1280-light', path: '/', width: 1280, charts: 4 },
	{ name: 'overview-1280-dark', path: '/', width: 1280, dark: true, charts: 4 },
	{ name: 'income-320-light', path: '/income', width: 320, charts: 0 },
	{ name: 'income-768-light', path: '/income', width: 768, charts: 0 },
	{ name: 'income-1280-dark', path: '/income', width: 1280, dark: true, charts: 0 },
	{ name: 'balance-768-light', path: '/balance', width: 768, charts: 0 },
	{ name: 'balance-1280-light', path: '/balance', width: 1280, charts: 0 },
	{ name: 'balance-320-light', path: '/balance', width: 320, charts: 0 },
	{ name: 'retirement-320-light', path: '/retirement', width: 320, charts: 1 },
	{ name: 'retirement-1280-dark', path: '/retirement', width: 1280, dark: true, charts: 1 },
	{ name: 'settings-320-light', path: '/settings', width: 320, charts: 0 },
	{ name: 'savings-320-light', path: '/savings', width: 320, charts: 0 },
]

async function open(
	page: Page,
	{ path, width, height = 900, dark, charts, seed = true }: Omit<Shot, 'name'>
) {
	await page.setViewportSize({ width, height })
	await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
	await page.clock.setFixedTime(FIXED_NOW)
	if (seed) await seedFinanceRows(page)
	await page.goto(path)
	await page.waitForLoadState('networkidle')
	await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
	await chartsDrawn(page, charts)
}

const FOOTER_LABELS = [
	'Pricing',
	'Documentation',
	'Terms of Service',
	'Privacy Policy',
	'Refund Policy',
	'Contact',
]

async function expectPhoneFooter(page: Page) {
	const footer = page.getByRole('contentinfo')
	const boxes: Box[] = []
	for (const label of FOOTER_LABELS) {
		boxes.push(
			await expectTarget(
				footer.getByRole('link', { name: label, exact: true }),
				`footer "${label}"`
			)
		)
	}
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const [a, b] = [boxes[i], boxes[j]]
			const overlap =
				a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
			expect(overlap, `footer "${FOOTER_LABELS[i]}" overlaps "${FOOTER_LABELS[j]}"`).toBe(false)
		}
	}
	const perRow = new Map<number, number>()
	for (const b of boxes) perRow.set(Math.round(b.y), (perRow.get(Math.round(b.y)) ?? 0) + 1)
	expect([...perRow.values()], 'footer links are not three rows of two').toEqual([2, 2, 2])
	await expectTarget(
		footer.getByRole('link', { name: /Lucas Silbernagel/ }),
		'footer author link',
		{
			sides: 'height',
		}
	)
}

for (const shot of PAGE_SHOTS) {
	test(shot.name, async ({ page }) => {
		await open(page, shot)
		if (shot.name === 'income-768-light') {
			// The header gear is hidden below 640px only; this is the positive control.
			await expect(page.locator('[data-auth-indicator] a[href="/settings"]')).toBeVisible()
		}
		if (shot.name === 'income-320-light') await expectPhoneFooter(page)
		await expect(page).toHaveScreenshot(`${shot.name}.png`, {
			fullPage: true,
			mask: await copyrightYear(page),
			timeout: SHOT_TIMEOUT,
		})
	})
}

test('nav-more-sheet-320-light', async ({ page }) => {
	await open(page, { path: '/', width: 320, charts: 4 })
	// toHaveCount(1) first: toBeHidden() passes on a locator matching nothing.
	const gear = page.locator('[data-auth-indicator] a[href="/settings"]')
	await expect(gear).toHaveCount(1)
	await expect(gear).toBeHidden()
	// Positive control: the signed-out cluster rendered at all.
	await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible()
	await expectTarget(page.getByRole('link', { name: 'Upgrade', exact: true }), 'Upgrade')
	await expectTarget(page.getByRole('link', { name: 'Sign in', exact: true }), 'Sign in')
	await expectPhoneStrip(page, 320)
	await expectBarCells(page, 5)
	await openMore(page)
	const rows = page.locator('nav[aria-label="Primary"] details ul').getByRole('link')
	await expect(rows).toHaveCount(3)
	for (let i = 0; i < 3; i++) await expectTarget(rows.nth(i), `sheet row ${i + 1}`)
	await expect(rows.last()).toHaveAccessibleName('Settings')
	await expect(rows.last()).toBeVisible()
	// `toBeVisible()` ignores clipping by the sheet's max-h scroll box.
	await expect(rows.last()).toBeInViewport({ ratio: 1 })
	// Viewport, not full page: the sheet is a fixed overlay.
	await expect(page).toHaveScreenshot('nav-more-sheet-320-light.png', {
		mask: await copyrightYear(page),
		timeout: SHOT_TIMEOUT,
	})
})

/** Short and fixed, so the avatar initial never moves. */
const SIGNED_IN_EMAIL = 'free@example.test'

test('account-menu-320-open', async ({ page }) => {
	// This server's SSR seed is signed out, so mock a signed-in session.
	await mockSignedIn(page, { email: SIGNED_IN_EMAIL, subscriptionStatus: 'free' })
	await open(page, { path: '/', width: 320, height: 640, charts: 4 })
	await expectSignedInAs(page, SIGNED_IN_EMAIL)
	await expectTarget(accountTrigger(page), 'Account menu trigger')
	await expectPhoneStrip(page, 320)
	const panel = await openAccountMenu(page)
	// A shot of the closed menu would be a vacuous baseline; Sign out proves it's open.
	await expect(panel.getByRole('button', { name: 'Sign out' })).toBeVisible()
	await expectTarget(panel.getByRole('button', { name: 'Sign out' }), 'Sign out', {
		sides: 'height',
	})
	// CSS locators with toHaveCount(1) first: a role query already skips display:none,
	// and toBeHidden() passes on zero matches.
	const panelSettings = panel.locator('a[href="/settings"]')
	await expect(panelSettings).toHaveCount(1)
	await expect(panelSettings).toBeHidden()
	const separator = panel.locator('hr')
	await expect(separator).toHaveCount(1)
	await expect(separator).toBeHidden()
	// Viewport, not full page: the panel is an overlay hanging from the top strip.
	await expect(page).toHaveScreenshot('account-menu-320-open.png', {
		mask: await copyrightYear(page),
		timeout: SHOT_TIMEOUT,
	})
})

/**
 * Checks before clicking: a retry after a click that did open the dialog would click
 * a trigger now covered by the overlay.
 */
async function openBalanceAddModal(page: Page): Promise<Locator> {
	const trigger = page.getByTestId('balance-add-button')
	const dialog = page.getByRole('dialog', { name: 'Add Balance Entry' })
	await expect(async () => {
		// Bounded: a trigger under the backdrop fails this attempt, not the whole test.
		if (!(await dialog.isVisible())) await trigger.click({ timeout: 1000 })
		await expect(dialog).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: SHOT_TIMEOUT })
	return dialog
}

test('modal-320x480', async ({ page }) => {
	// The tallest modal: on empty storage the type defaults to `investment`, the arm
	// that shows every field.
	await open(page, { path: '/balance', width: 320, height: 480, charts: 0, seed: false })
	const dialog = await openBalanceAddModal(page)
	await expect(dialog.getByLabel(/type/i)).toHaveValue('investment')
	// A form that lost its tallest arm fails here with a name, not as a pixel diff.
	await expect(
		dialog.getByRole('checkbox', { name: 'Not taken from the money left over' })
	).toBeVisible()
	await expect(dialog.getByRole('button', { name: 'Add Balance Entry' })).toBeVisible()
	// Viewport: what matters is how the capped card sits on a short screen.
	await expect(page).toHaveScreenshot('modal-320x480.png', {
		mask: await copyrightYear(page),
		timeout: SHOT_TIMEOUT,
	})
})
