// Not auth-gated: accounts are created only by the Paddle webhook on a completed checkout,
// so requiring sign-in would lock out new customers. The session only pre-fills the email.

import { useEffect, useRef, useState } from 'react'
import { type SessionSeed, useSessionSeed } from '../../context/session-seed'
import {
	getLocalizedPlanPrices,
	getPaddleInstance,
	type LocalizedPriceBreakdown,
	openPaddleCheckout,
} from '../../lib/paddle/checkout'
import { hasPaidAccess, type PaidAccessStatus } from '../../lib/premium/access-statuses'

type Plan = 'monthly' | 'annual' | 'lifetime'
type Status = 'idle' | 'loading' | 'error'

type CheckoutConfig = {
	isConfigured: boolean
	environment: 'sandbox' | 'production'
	clientToken: string | null
	/** Null only outside production; the plan then renders disabled rather than removed. */
	monthlyPriceId: string | null
	annualPriceId: string | null
	lifetimePriceId: string | null
}

const FALLBACK_LABEL: Record<Plan, string> = {
	monthly: '€5.99/mo',
	annual: '€39/yr',
	lifetime: '€99',
}

// These states have nothing to buy, and checkout risks a duplicate charge. `canceled` is
// excluded: that subscription has ended, so checkout is how they resubscribe.
function AlreadyPremiumNotice({ status }: { status: PaidAccessStatus }) {
	if (status === 'lifetime') {
		return (
			<p className="mt-6 text-sm text-body">
				You already have lifetime Premium access — there&apos;s nothing more to buy.
			</p>
		)
	}
	if (status === 'past_due') {
		return (
			<p className="mt-6 text-sm text-body">
				Your Premium subscription has a payment issue. Buying a new plan won&apos;t fix this and
				would charge you again — please update your payment details with Paddle instead.
			</p>
		)
	}
	return <p className="mt-6 text-sm text-body">You already have an active Premium subscription.</p>
}

// A `null` seed means unverified, not signed out: ask `/api/auth/me` rather than guess.
function useResolvedStatusWhenUnverified(seedIsNull: boolean) {
	const [status, setStatus] = useState<string | null | undefined>(seedIsNull ? undefined : null)

	useEffect(() => {
		if (!seedIsNull) return
		let cancelled = false
		void (async () => {
			try {
				const res = await fetch('/api/auth/me')
				const body = (await res.json()) as { user?: { subscriptionStatus?: string } | null }
				if (!cancelled) setStatus(body?.user?.subscriptionStatus ?? null)
			} catch {
				// Fail open: the checkout-config endpoint refuses an entitled session regardless.
				if (!cancelled) setStatus(null)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [seedIsNull])

	return status
}

export function PremiumCheckoutButton() {
	const seed = useSessionSeed()
	const resolvedStatus = useResolvedStatusWhenUnverified(seed === null)

	const status = seed ? (seed.subscriptionStatus ?? null) : resolvedStatus

	if (status === undefined) {
		return <p className="mt-6 text-sm text-body">Checking your account…</p>
	}

	if (hasPaidAccess(status)) {
		return <AlreadyPremiumNotice status={status} />
	}

	return <PremiumCheckoutForm seed={seed} />
}

// Split out so its hooks stay unconditional after the parent's early return.
function PremiumCheckoutForm({ seed }: { seed: SessionSeed | null }) {
	const [plan, setPlan] = useState<Plan>('annual')
	const [config, setConfig] = useState<CheckoutConfig | null>(null)
	const [localizedPrice, setLocalizedPrice] = useState<
		Record<Plan, LocalizedPriceBreakdown | null>
	>({
		monthly: null,
		annual: null,
		lifetime: null,
	})
	const [status, setStatus] = useState<Status>('idle')

	// Drain the body even on error: an unread body keeps the request open, so the page
	// never reaches network-idle.
	useEffect(() => {
		let cancelled = false
		fetch('/api/paddle/checkout-config')
			.then(async (response) => {
				if (response.ok) return (await response.json()) as CheckoutConfig
				await response.text()
				return null
			})
			.then((data) => {
				if (!cancelled) {
					setConfig(data)
				}
			})
			.catch(() => {
				if (!cancelled) {
					setConfig(null)
				}
			})
		return () => {
			cancelled = true
		}
	}, [])

	useEffect(() => {
		if (
			!config?.isConfigured ||
			!config.clientToken ||
			!config.annualPriceId ||
			!config.lifetimePriceId
		) {
			return
		}
		let cancelled = false
		getPaddleInstance({ environment: config.environment, clientToken: config.clientToken })
			.then((paddle) => {
				if (!paddle || cancelled) return
				return getLocalizedPlanPrices(paddle, {
					// Only a configured monthly id: an undefined line item fails the whole preview call.
					monthlyPriceId: config.monthlyPriceId ?? undefined,
					annualPriceId: config.annualPriceId as string,
					lifetimePriceId: config.lifetimePriceId as string,
				})
			})
			.then((prices) => {
				if (prices && !cancelled) {
					setLocalizedPrice({
						monthly: prices.monthly,
						annual: prices.annual,
						lifetime: prices.lifetime,
					})
				}
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [config])

	const handleCheckout = async () => {
		const priceIdForPlan: Record<Plan, string | null | undefined> = {
			monthly: config?.monthlyPriceId,
			annual: config?.annualPriceId,
			lifetime: config?.lifetimePriceId,
		}
		const priceId = priceIdForPlan[plan]
		if (!config?.isConfigured || !config.clientToken || !priceId) {
			setStatus('error')
			return
		}

		setStatus('loading')
		try {
			const paddle = await getPaddleInstance({
				environment: config.environment,
				clientToken: config.clientToken,
			})
			if (!paddle) {
				throw new Error('Paddle.js failed to initialize')
			}
			openPaddleCheckout(paddle, priceId, {
				customerEmail: seed?.email ?? undefined,
				successUrl: `${window.location.origin}/welcome`,
			})
			setStatus('idle')
		} catch {
			setStatus('error')
		}
	}

	const planOptions: ReadonlyArray<{ id: Plan; label: string; disabled: boolean }> = [
		{
			id: 'monthly',
			label: `Monthly · ${localizedPrice.monthly?.total ?? FALLBACK_LABEL.monthly}`,
			disabled: !config?.monthlyPriceId,
		},
		{
			id: 'annual',
			label: `Annual · ${localizedPrice.annual?.total ?? FALLBACK_LABEL.annual}`,
			disabled: !config?.annualPriceId,
		},
		{
			id: 'lifetime',
			label: `Lifetime · ${localizedPrice.lifetime?.total ?? FALLBACK_LABEL.lifetime}`,
			disabled: !config?.lifetimePriceId,
		},
	]
	const enabledPlanIds = planOptions.filter((o) => !o.disabled).map((o) => o.id)
	const radioRefs = useRef<Partial<Record<Plan, HTMLButtonElement | null>>>({})

	// A disabled selected plan leaves no radio with tabIndex 0, so the group is keyboard-unreachable;
	// move the selection to the first enabled option.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see comment above; only config/plan can flip `disabled`
	useEffect(() => {
		const selected = planOptions.find((o) => o.id === plan)
		if (selected?.disabled && enabledPlanIds.length > 0 && enabledPlanIds[0]) {
			setPlan(enabledPlanIds[0])
		}
	}, [config, plan])

	const handleRadioKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentId: Plan) => {
		if (enabledPlanIds.length === 0) return
		const currentIndex = enabledPlanIds.indexOf(currentId)
		let nextIndex: number | undefined
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				nextIndex = (currentIndex + 1) % enabledPlanIds.length
				break
			case 'ArrowLeft':
			case 'ArrowUp':
				nextIndex = (currentIndex - 1 + enabledPlanIds.length) % enabledPlanIds.length
				break
			case 'Home':
				nextIndex = 0
				break
			case 'End':
				nextIndex = enabledPlanIds.length - 1
				break
			default:
				return
		}
		event.preventDefault()
		const nextId = enabledPlanIds[nextIndex]
		if (nextId) {
			setPlan(nextId)
			radioRefs.current[nextId]?.focus()
		}
	}

	// Localized totals include tax and can differ from the reference price, so show the breakdown.
	const selectedBreakdown = localizedPrice[plan]

	return (
		<div className="mt-6 flex flex-col gap-3">
			<div
				role="radiogroup"
				aria-label="Premium plan"
				className="flex rounded-lg border border-gray-300 dark:border-gray-600 p-1 text-sm"
			>
				{planOptions.map(({ id, label, disabled }) => (
					// biome-ignore lint/a11y/useSemanticElements: roving-tabindex buttons implement the ARIA radio pattern
					<button
						key={id}
						ref={(el) => {
							radioRefs.current[id] = el
						}}
						type="button"
						role="radio"
						aria-checked={plan === id}
						disabled={disabled}
						tabIndex={plan === id ? 0 : -1}
						onClick={() => setPlan(id)}
						onKeyDown={(event) => handleRadioKeyDown(event, id)}
						className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
							plan === id
								? 'bg-blue-600 text-white'
								: 'text-body hover:bg-gray-100 dark:hover:bg-gray-700'
						}`}
					>
						{label}
					</button>
				))}
			</div>

			{selectedBreakdown && (
				<p className="text-xs text-muted">
					{selectedBreakdown.subtotal} + {selectedBreakdown.tax} tax = {selectedBreakdown.total}
				</p>
			)}

			<button
				type="button"
				onClick={handleCheckout}
				disabled={status === 'loading'}
				aria-busy={status === 'loading'}
				className="inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
			>
				{status === 'loading' ? 'Opening checkout…' : 'Get Premium'}
			</button>

			{status === 'error' && (
				<p role="alert" className="text-sm text-red-600 dark:text-red-400">
					Checkout isn&apos;t available right now. Please try again shortly.
				</p>
			)}
		</div>
	)
}
