import { expect, type Locator, type Page } from '@playwright/test'

/** Fixes browser-rendered dates only; the footer year is server-rendered. */
export const FIXED_NOW = new Date('2026-08-11T12:00:00.000Z')

/** Recharts animates with JS for ~1.5 s, which `animations: 'disabled'` does not stop. */
export const SHOT_TIMEOUT = 15_000

/**
 * The footer year is rendered on the server, which page.clock can't reach; unmasked,
 * every shot would turn red on 1 January.
 */
export async function copyrightYear(page: Page): Promise<Locator[]> {
	const year = page.locator('footer span').filter({ hasText: /^Copyright \d{4}/ })
	// A mask that matches nothing masks nothing and passes.
	await expect(year, 'the copyright-year mask matched no footer text').toHaveCount(1)
	return [year]
}

/**
 * Two identical frames aren't enough: lazy charts can be captured blank and stable.
 * `count` is exact, so a missing or extra chart fails with a message.
 */
export async function chartsDrawn(page: Page, count: number): Promise<void> {
	await expect(page.locator('.recharts-surface')).toHaveCount(count, { timeout: SHOT_TIMEOUT })
	// A pie paints no sector until its animation begins, 400 ms after mount; two blank frames in that
	// window count as a stable screenshot. Viewport shots have no bar chart in view to keep them unstable.
	await expect(page.locator('.recharts-pie:not(:has(.recharts-sector))')).toHaveCount(0, {
		timeout: SHOT_TIMEOUT,
	})
}

const PHONE_TARGET_PX = 44

/**
 * 44px content plus a 1px border. Pinned per state, never as an equality between
 * states, which can't catch both drifting together.
 */
const PHONE_STRIP_PX = 45

export type Box = {
	x: number
	y: number
	width: number
	height: number
}

/**
 * `toHaveCount(1)` first: boundingBox() on a locator matching nothing is vacuous.
 * jsdom loads no Tailwind, so sizes are checked here.
 */
export async function expectTarget(
	locator: Locator,
	label: string,
	{ min = PHONE_TARGET_PX, sides = 'both' }: { min?: number; sides?: 'both' | 'height' } = {}
): Promise<Box> {
	await expect(locator, `${label}: expected exactly one match`).toHaveCount(1)
	await expect(locator, `${label}: not visible`).toBeVisible()
	const box = await locator.boundingBox()
	expect(box, `${label}: no layout box`).not.toBeNull()
	const b = box as Box
	expect(b.height, `${label} is ${b.height}px tall, under ${min}`).toBeGreaterThanOrEqual(min)
	if (sides === 'both') {
		expect(b.width, `${label} is ${b.width}px wide, under ${min}`).toBeGreaterThanOrEqual(min)
	}
	return b
}

export async function expectPhoneStrip(page: Page, width: number): Promise<void> {
	const strip = page.locator('[data-auth-indicator]')
	await expect(strip).toHaveCount(1)
	const box = await strip.boundingBox()
	expect(box?.height, 'the phone top strip height').toBe(PHONE_STRIP_PX)
	const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
	expect(scrollWidth, 'the page scrolls sideways').toBeLessThanOrEqual(width)
}

export async function expectBarCells(page: Page, expectedVisible: number): Promise<void> {
	const cells = page.locator(
		'nav[aria-label="Primary"] > ul > li > a, nav[aria-label="Primary"] > ul > li > details > summary'
	)
	let visible = 0
	for (const cell of await cells.all()) {
		if (!(await cell.isVisible())) continue
		visible += 1
		const name = ((await cell.textContent()) ?? '').trim()
		await expectTarget(cell, `bar cell "${name}"`)
	}
	expect(visible, 'visible bottom-bar cells').toBe(expectedVisible)
}
