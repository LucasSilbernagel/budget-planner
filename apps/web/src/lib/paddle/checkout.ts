import type { Environments, Paddle } from '@paddle/paddle-js'

export interface PaddleCheckoutClientConfig {
	environment: Environments
	clientToken: string
}

// Paddle.js is itself a singleton; re-initializing would inject a duplicate script tag.
let paddleInstancePromise: Promise<Paddle | undefined> | null = null

type ProfitwellStub = ((...args: unknown[]) => void) & { isLoaded: boolean }

/**
 * Paddle.Initialize() loads ProfitWell unless `window.profitwell?.isLoaded`; a no-op stub stops it.
 * This disables Paddle Retain features: revisit before enabling Retain.
 */
export function preemptPaddleRetainSnippet(): void {
	if (typeof window === 'undefined') return
	const host = window as Window & { profitwell?: unknown }
	if (host.profitwell != null) return
	const stub: ProfitwellStub = Object.assign((..._args: unknown[]) => {}, { isLoaded: true })
	host.profitwell = stub
}

export function getPaddleInstance(config: PaddleCheckoutClientConfig): Promise<Paddle | undefined> {
	if (!paddleInstancePromise) {
		paddleInstancePromise = import('@paddle/paddle-js')
			.then(({ initializePaddle }) => {
				// Before `initializePaddle`: its `Paddle.Initialize()` runs the ProfitWell check.
				preemptPaddleRetainSnippet()
				return initializePaddle({ token: config.clientToken, environment: config.environment })
			})
			.then((paddle) => {
				// `initializePaddle` signals failure by resolving `undefined`, not rejecting; clear the cache so
				// later clicks retry.
				if (!paddle) {
					paddleInstancePromise = null
				}
				return paddle
			})
			.catch((error) => {
				// Un-cache a rejection so the next call retries.
				paddleInstancePromise = null
				throw error
			})
	}
	return paddleInstancePromise
}

export function resetPaddleInstanceForTests(): void {
	paddleInstancePromise = null
}

/** Pre-formatted display strings; never do math on them. */
export interface LocalizedPriceBreakdown {
	subtotal: string
	tax: string
	total: string
}

export interface LocalizedPlanPrices {
	monthly: LocalizedPriceBreakdown | null
	annual: LocalizedPriceBreakdown | null
	lifetime: LocalizedPriceBreakdown | null
}

/**
 * No country passed: Paddle geolocates by IP, and Rapids sets no geo header. Never recompute or
 * reformat the totals: Paddle already applied currency and tax.
 */
export async function getLocalizedPlanPrices(
	paddle: Paddle,
	priceIds: {
		/** Optional: previewing an undefined price id fails the whole PricePreview call. */
		monthlyPriceId?: string | undefined
		annualPriceId: string
		lifetimePriceId: string
	}
): Promise<LocalizedPlanPrices> {
	const requiredItems = [
		{ priceId: priceIds.annualPriceId, quantity: 1 },
		{ priceId: priceIds.lifetimePriceId, quantity: 1 },
	]
	const monthlyItem = priceIds.monthlyPriceId
		? [{ priceId: priceIds.monthlyPriceId, quantity: 1 }]
		: []

	// PricePreview is all-or-nothing; retry without monthly so a bad monthly id cannot strand the
	// annual and lifetime totals.
	let preview: Awaited<ReturnType<typeof paddle.PricePreview>>
	let monthlyRequested = monthlyItem.length > 0
	try {
		preview = await paddle.PricePreview({ items: [...monthlyItem, ...requiredItems] })
	} catch (error) {
		if (!monthlyRequested) throw error
		monthlyRequested = false
		preview = await paddle.PricePreview({ items: requiredItems })
	}

	const breakdownFor = (priceId: string | undefined): LocalizedPriceBreakdown | null => {
		if (!priceId) return null
		const formatted = preview.data.details.lineItems.find(
			(item) => item.price.id === priceId
		)?.formattedTotals
		return formatted
			? { subtotal: formatted.subtotal, tax: formatted.tax, total: formatted.total }
			: null
	}

	return {
		monthly: monthlyRequested ? breakdownFor(priceIds.monthlyPriceId) : null,
		annual: breakdownFor(priceIds.annualPriceId),
		lifetime: breakdownFor(priceIds.lifetimePriceId),
	}
}

export function openPaddleCheckout(
	paddle: Paddle,
	priceId: string,
	options: { customerEmail?: string; successUrl: string }
): void {
	paddle.Checkout.open({
		items: [{ priceId, quantity: 1 }],
		settings: { displayMode: 'overlay', variant: 'one-page', successUrl: options.successUrl },
		...(options.customerEmail ? { customer: { email: options.customerEmail } } : {}),
	})
}
