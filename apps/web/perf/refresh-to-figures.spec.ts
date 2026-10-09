import { expect, type Page, test } from '@playwright/test'

// Manual measurement only (playwright.perf.config.ts) against a production build you
// started. Never a CI assertion: shared-runner timings belong to the runner.

// A MutationObserver armed before any app script timestamps the figure. The element is
// already in the SSR HTML, so the predicate keys on its text, never its appearance.

/** A wait budget, not a performance budget. */
const COLD_COMPILE_TIMEOUT_MS = 60_000

/** Odd, so the median is a real reading. */
const SAMPLES = 11

const SEED_SIZE = { income: 3, expenses: 5, savingsGoals: 2, balanceEntries: 4 } as const

// investments 5_000_000 + savings 300_000 − debts 395_000 = 4_905_000 cents
const EXPECTED_NET_WORTH = '$49,050.00'

// Each envelope carries its own store's current version (they differ), so no migrate
// runs. Savings must stay seeded: balance selectors are pure and can't detect anything.
function seedOverview() {
	const now = '2026-01-01T00:00:00.000Z'
	const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`

	localStorage.setItem(
		'budget-planner:savings-goals',
		JSON.stringify({
			state: {
				savingsGoals: [
					{
						id: id(1),
						name: 'Emergency fund',
						targetAmount: 1000000,
						currentBalance: 250000,
						allocationMode: 'manual',
						monthlyAllocation: 20000,
						sortOrder: 0,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(2),
						name: 'Rainy day',
						targetAmount: null,
						currentBalance: 50000,
						allocationMode: 'manual',
						monthlyAllocation: 10000,
						sortOrder: 1,
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			version: 3,
		})
	)

	localStorage.setItem(
		'budget-planner:balance-tracking',
		JSON.stringify({
			state: {
				entries: [
					{
						id: id(3),
						type: 'investment',
						name: 'ISA',
						currentBalance: 800000,
						monthlyContribution: 0,
						frequency: 'monthly',
						sortOrder: 0,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(4),
						type: 'investment',
						name: 'Pension',
						currentBalance: 4200000,
						monthlyContribution: 0,
						frequency: 'monthly',
						sortOrder: 1,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(5),
						type: 'debt',
						name: 'Car loan',
						currentBalance: 350000,
						monthlyContribution: 0,
						frequency: 'monthly',
						sortOrder: 2,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(6),
						type: 'debt',
						name: 'Credit card',
						currentBalance: 45000,
						monthlyContribution: 0,
						frequency: 'monthly',
						sortOrder: 3,
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			version: 4,
		})
	)

	localStorage.setItem(
		'budget-planner-income-v1',
		JSON.stringify({
			state: {
				incomeSources: [
					{
						id: id(7),
						name: 'Salary',
						amount: 500000,
						frequency: 'monthly',
						categoryId: null,
						sortOrder: 0,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(8),
						name: 'Freelance',
						amount: 80000,
						frequency: 'monthly',
						categoryId: null,
						sortOrder: 1,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(9),
						name: 'Dividends',
						amount: 120000,
						frequency: 'annually',
						categoryId: null,
						sortOrder: 2,
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			version: 3,
		})
	)

	localStorage.setItem(
		'budget-planner-expenses-v1',
		JSON.stringify({
			state: {
				expenses: [
					{
						id: id(10),
						name: 'Rent',
						amount: 150000,
						frequency: 'monthly',
						categoryId: null,
						sortOrder: 0,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(11),
						name: 'Groceries',
						amount: 60000,
						frequency: 'monthly',
						categoryId: null,
						sortOrder: 1,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(12),
						name: 'Utilities',
						amount: 25000,
						frequency: 'monthly',
						categoryId: null,
						sortOrder: 2,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(13),
						name: 'Transport',
						amount: 18000,
						frequency: 'monthly',
						categoryId: null,
						sortOrder: 3,
						createdAt: now,
						updatedAt: now,
					},
					{
						id: id(14),
						name: 'Subscriptions',
						amount: 4500,
						frequency: 'monthly',
						categoryId: null,
						sortOrder: 4,
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			version: 3,
		})
	)
}

type FigureReading = {
	at: number | null
	text: string | null
	source: 'observer' | 'initial' | null
	observerRan: boolean
}

/**
 * Install before goto. `source` is anti-vacuity: a figure already present at document
 * start would measure nothing, so assertHonest requires 'observer'.
 */
function armFigureObserver() {
	const w = window as unknown as { __figure?: FigureReading }
	const reading: FigureReading = { at: null, text: null, source: null, observerRan: false }
	w.__figure = reading

	const read = (): string | null => {
		const el = document.querySelector('[data-testid="overview-net-worth"]')
		const text = el?.textContent?.trim()
		return text === undefined || text === '' ? null : text
	}

	// Currency-shaped with well-formed groups, and nonzero once parsed: `-$0.00` is a real
	// Intl output that must not count as the user's figure.
	const isRealFigure = (text: string | null): boolean => {
		if (text === null || !/^-?\$\d{1,3}(?:,\d{3})*\.\d{2}$/.test(text)) {
			return false
		}
		return Number.parseFloat(text.replace(/[$,]/g, '')) !== 0
	}

	const record = (source: 'observer' | 'initial', text: string) => {
		if (reading.at !== null) return
		reading.at = performance.now()
		reading.text = text
		reading.source = source
	}

	const initial = read()
	if (isRealFigure(initial)) record('initial', initial as string)

	const observer = new MutationObserver(() => {
		reading.observerRan = true
		if (reading.at !== null) return
		const text = read()
		if (isRealFigure(text)) record('observer', text as string)
	})
	observer.observe(document, { subtree: true, childList: true, characterData: true })
}

/**
 * Loopback delivers bytes in ~0 ms, hiding what a byte saving costs in transfer, so
 * more than one condition is measured.
 */
type Condition = {
	name: string
	cpu: number
	network: { downloadKbps: number; uploadKbps: number; latencyMs: number } | null
	/** A refresh re-reads JS from the HTTP cache; a cold cache models a first visit. */
	coldCache: boolean
}

// No modelled-network arm: emulateNetworkConditions measurably contributed nothing
// through this harness.
const CONDITIONS: Condition[] = [
	{ name: 'cpu 1x, loopback, warm cache', cpu: 1, network: null, coldCache: false },
	{ name: 'cpu 4x, loopback, warm cache', cpu: 4, network: null, coldCache: false },
	{ name: 'cpu 4x, loopback, cold cache', cpu: 4, network: null, coldCache: true },
]

async function applyCondition(page: Page, condition: Condition): Promise<void> {
	const client = await page.context().newCDPSession(page)
	await client.send('Emulation.setCPUThrottlingRate', { rate: condition.cpu })
	await client.send('Network.enable')
	await client.send('Network.setCacheDisabled', { cacheDisabled: condition.coldCache })
	if (condition.network !== null) {
		await client.send('Network.emulateNetworkConditions', {
			offline: false,
			// CDP wants bytes/second; the preset is quoted in kilobits.
			downloadThroughput: (condition.network.downloadKbps * 1000) / 8,
			uploadThroughput: (condition.network.uploadKbps * 1000) / 8,
			latency: condition.network.latencyMs,
		})
	}
}

/** `about:blank` first, so every sample is a fresh document with init scripts re-run. */
async function measureOnce(page: Page): Promise<FigureReading> {
	await page.goto('about:blank')
	await page.goto('/', { waitUntil: 'commit' })
	// A wait, not the measurement: the number is recorded in-page first, so a longer
	// timeout can't inflate it.
	await expect(page.getByTestId('overview-net-worth')).toHaveText(EXPECTED_NET_WORTH, {
		timeout: COLD_COMPILE_TIMEOUT_MS,
	})
	return await page.evaluate(() => (window as unknown as { __figure: FigureReading }).__figure)
}

function assertHonest(reading: FigureReading): void {
	expect(reading.observerRan, 'the MutationObserver never ran — the instrument was not armed').toBe(
		true
	)
	expect(
		reading.source,
		`expected the timestamp to come from the observer, got source=${reading.source}`
	).toBe('observer')
	expect(reading.text, 'the recorded text must be the seeded figure').toBe(EXPECTED_NET_WORTH)
	expect(reading.at, 'no timestamp was recorded').not.toBeNull()
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[(sorted.length - 1) >> 1] as number
}

test.describe('refresh-to-figures', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(seedOverview)
		await page.addInitScript(armFigureObserver)
	})

	test.describe('MEASUREMENT', () => {
		test('medians under each named condition, with the throttle control', async ({ page }) => {
			expect(
				process.env['PLAYWRIGHT_BASE_URL'],
				'set PLAYWRIGHT_BASE_URL to a production build you started (recipe: this file header)'
			).toBeTruthy()
			test.setTimeout(900_000)

			// A config change would otherwise silently move every recorded median.
			expect(page.viewportSize()).toEqual({ width: 1280, height: 720 })

			const medians = new Map<string, number>()
			for (const condition of CONDITIONS) {
				await applyCondition(page, condition)
				const readings: number[] = []
				for (let i = 0; i < SAMPLES; i++) {
					const reading = await measureOnce(page)
					assertHonest(reading)
					readings.push(reading.at as number)
				}
				const sorted = [...readings].sort((a, b) => a - b)
				medians.set(condition.name, median(readings))
				console.log(
					`[M2] ${condition.name} | seed=${JSON.stringify(SEED_SIZE)} n=${SAMPLES} median=${median(
						readings
					).toFixed(1)}ms ` +
						`min=${(sorted[0] as number).toFixed(1)}ms ` +
						`max=${(sorted.at(-1) as number).toFixed(1)}ms ` +
						`all=[${sorted.map((v) => v.toFixed(0)).join(', ')}]`
				)
			}

			// Throttle control: if CPU throttling silently failed, every "4x" figure would be an
			// unthrottled reading under a false label.
			const fast = medians.get('cpu 1x, loopback, warm cache') as number
			const slowCpu = medians.get('cpu 4x, loopback, warm cache') as number
			const cold = medians.get('cpu 4x, loopback, cold cache') as number
			console.log(
				`[control:throttle] cpu 4x/1x = ${(slowCpu / fast).toFixed(2)}x | cold/warm @4x = ${(
					cold / slowCpu
				).toFixed(2)}x`
			)
			const cpuWhy = `4x median (${slowCpu.toFixed(
				1
			)}ms) is not above the 1x median (${fast.toFixed(
				1
			)}ms) — the CPU throttle did not take, so neither figure means what it says`
			expect(slowCpu, cpuWhy).toBeGreaterThan(fast * 1.5)
			// Same cpu rate, so exactly one variable (the cache) changes.
			const cacheWhy = `the cold-cache median (${cold.toFixed(
				1
			)}ms) is not above the warm-cache median at the same CPU rate (${slowCpu.toFixed(
				1
			)}ms) — Network.setCacheDisabled did not take`
			expect(cold, cacheWhy).toBeGreaterThan(slowCpu * 1.2)
		})
	})
})
