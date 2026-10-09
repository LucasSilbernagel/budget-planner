import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionSeedProvider } from '@/context/session-seed-provider'
import { resetPaddleInstanceForTests } from '../../../lib/paddle/checkout'
import { PremiumCheckoutButton } from '../premium-checkout-button'

const checkoutOpen = vi.fn()
const pricePreview = vi.fn()
const initializePaddle = vi.fn()

vi.mock('@paddle/paddle-js', () => ({
	initializePaddle: (...args: unknown[]) => initializePaddle(...args),
}))

const originalFetch = global.fetch

/** No `monthlyPriceId` on purpose: annual + lifetime only is a real supported build. */
const CONFIGURED = {
	isConfigured: true,
	environment: 'sandbox' as const,
	clientToken: 'test_client_token',
	monthlyPriceId: null,
	annualPriceId: 'pri_annual_test',
	lifetimePriceId: 'pri_lifetime_test',
}

const CONFIGURED_WITH_MONTHLY = {
	...CONFIGURED,
	monthlyPriceId: 'pri_monthly_test',
}

/** Carries a monthly line the default fixture never requests: ids must be looked up, not indexed. */
const PRICE_PREVIEW_RESPONSE = {
	data: {
		details: {
			lineItems: [
				{
					price: { id: 'pri_monthly_test' },
					formattedTotals: { subtotal: '€5.99', tax: '€0.78', total: '€6.77' },
				},
				{
					price: { id: 'pri_annual_test' },
					formattedTotals: { subtotal: '€39.00', tax: '€5.07', total: '€44.07' },
				},
				{
					price: { id: 'pri_lifetime_test' },
					formattedTotals: { subtotal: '€99.00', tax: '€12.87', total: '€111.87' },
				},
			],
		},
	},
}

function stubConfigFetch(config: unknown) {
	global.fetch = vi.fn((input: RequestInfo | URL) => {
		if (String(input).includes('/api/paddle/checkout-config')) {
			return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }))
		}
		return Promise.resolve(new Response('{}', { status: 200 }))
	}) as typeof global.fetch
}

/**
 * Radios render disabled until checkout-config settles, so `findByRole` alone resolves
 * against the pre-config render.
 */
async function findEnabledRadio(name: RegExp): Promise<HTMLElement> {
	const radio = await screen.findByRole('radio', { name })
	await waitFor(() => expect(radio).not.toBeDisabled())
	return radio
}

beforeEach(() => {
	resetPaddleInstanceForTests()
	checkoutOpen.mockReset()
	pricePreview.mockReset().mockResolvedValue(PRICE_PREVIEW_RESPONSE)
	initializePaddle
		.mockReset()
		.mockResolvedValue({ Checkout: { open: checkoutOpen }, PricePreview: pricePreview })
})

afterEach(() => {
	global.fetch = originalFetch
	vi.restoreAllMocks()
})

describe('PremiumCheckoutButton — price preview (auth-independent)', () => {
	it("shows Paddle's own localized totals once PricePreview resolves, replacing the static fallback", async () => {
		stubConfigFetch(CONFIGURED)
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		expect(screen.getByRole('radio', { name: 'Annual · €39/yr' })).toBeInTheDocument()
		expect(screen.queryByText(/tax/i)).not.toBeInTheDocument()
		expect(await screen.findByRole('radio', { name: 'Annual · €44.07' })).toBeInTheDocument()
		expect(screen.getByRole('radio', { name: 'Lifetime · €111.87' })).toBeInTheDocument()
		expect(screen.getByText('€39.00 + €5.07 tax = €44.07')).toBeInTheDocument()

		expect(pricePreview).toHaveBeenCalledWith({
			items: [
				{ priceId: 'pri_annual_test', quantity: 1 },
				{ priceId: 'pri_lifetime_test', quantity: 1 },
			],
		})
	})

	it('switches the breakdown line to the lifetime plan after toggling', async () => {
		stubConfigFetch(CONFIGURED)
		const user = userEvent.setup()
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		await screen.findByText('€39.00 + €5.07 tax = €44.07')
		await user.click(screen.getByRole('radio', { name: /^Lifetime/ }))

		expect(screen.getByText('€99.00 + €12.87 tax = €111.87')).toBeInTheDocument()
		expect(screen.queryByText('€39.00 + €5.07 tax = €44.07')).not.toBeInTheDocument()
	})
})

describe('PremiumCheckoutButton — the monthly plan', () => {
	const ANON_SEED = {
		isAuthenticated: false,
		userId: null,
		email: null,
		subscriptionStatus: null,
	} as const

	it('offers monthly as a third enabled plan and previews its real localized total', async () => {
		stubConfigFetch(CONFIGURED_WITH_MONTHLY)
		render(
			<SessionSeedProvider seed={ANON_SEED}>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		expect(screen.getByRole('radio', { name: 'Monthly · €5.99/mo' })).toBeInTheDocument()
		expect(await screen.findByRole('radio', { name: 'Monthly · €6.77' })).toBeInTheDocument()

		expect(pricePreview).toHaveBeenCalledWith({
			items: [
				{ priceId: 'pri_monthly_test', quantity: 1 },
				{ priceId: 'pri_annual_test', quantity: 1 },
				{ priceId: 'pri_lifetime_test', quantity: 1 },
			],
		})
	})

	it('keeps ANNUAL selected by default even when monthly is available — annual is the anchor', async () => {
		stubConfigFetch(CONFIGURED_WITH_MONTHLY)
		render(
			<SessionSeedProvider seed={ANON_SEED}>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		// Wait on the breakdown: the config resolves one await earlier than PricePreview.
		await screen.findByText('€39.00 + €5.07 tax = €44.07')

		expect(screen.getByRole('radio', { name: /^Annual/ })).toHaveAttribute('aria-checked', 'true')
		expect(screen.getByRole('radio', { name: /^Monthly/ })).toHaveAttribute('aria-checked', 'false')
	})

	it('opens checkout with the MONTHLY price id after selecting monthly — never the lifetime one', async () => {
		stubConfigFetch(CONFIGURED_WITH_MONTHLY)
		const user = userEvent.setup()
		render(
			<SessionSeedProvider seed={ANON_SEED}>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		await user.click(await findEnabledRadio(/^Monthly/))
		await screen.findByText('€5.99 + €0.78 tax = €6.77')

		await user.click(screen.getByRole('button', { name: /get premium/i }))

		await waitFor(() => expect(checkoutOpen).toHaveBeenCalledTimes(1))
		const call = checkoutOpen.mock.calls[0]?.[0] as { items: Array<{ priceId: string }> }
		expect(call.items).toEqual([{ priceId: 'pri_monthly_test', quantity: 1 }])
		// A two-branch ternary would send monthly to the lifetime price.
		expect(JSON.stringify(call.items)).not.toContain('pri_lifetime_test')
	})

	it('DISABLES monthly when its price id is unset, WITHOUT breaking the other two plans', async () => {
		// PricePreview must not send an undefined line item, which would fail every plan.
		stubConfigFetch(CONFIGURED)
		render(
			<SessionSeedProvider seed={ANON_SEED}>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		expect(await screen.findByRole('radio', { name: 'Annual · €44.07' })).toBeInTheDocument()
		expect(screen.getByRole('radio', { name: 'Lifetime · €111.87' })).toBeInTheDocument()

		const monthly = screen.getByRole('radio', { name: /^Monthly/ })
		expect(monthly).toBeDisabled()
		expect(monthly).toHaveAccessibleName('Monthly · €5.99/mo')

		expect(pricePreview).toHaveBeenCalledWith({
			items: [
				{ priceId: 'pri_annual_test', quantity: 1 },
				{ priceId: 'pri_lifetime_test', quantity: 1 },
			],
		})
	})
})

describe('PremiumCheckoutButton — signed out', () => {
	it('opens checkout directly with no pre-filled email — NOT gated behind sign-in', async () => {
		stubConfigFetch(CONFIGURED)
		const user = userEvent.setup()
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		await findEnabledRadio(/^Annual/)
		const button = await screen.findByRole('button', { name: 'Get Premium' })
		await user.click(button)

		await waitFor(() => expect(checkoutOpen).toHaveBeenCalledTimes(1))
		expect(checkoutOpen).toHaveBeenCalledWith({
			items: [{ priceId: 'pri_annual_test', quantity: 1 }],
			settings: {
				displayMode: 'overlay',
				variant: 'one-page',
				successUrl: expect.stringContaining('/welcome'),
			},
		})
	})
})

describe('PremiumCheckoutButton — signed in', () => {
	it('opens a one-page overlay checkout with the annual price by default, pre-filling the signed-in email and redirecting to /welcome on success', async () => {
		stubConfigFetch(CONFIGURED)
		const user = userEvent.setup()
		render(
			<SessionSeedProvider
				seed={{
					isAuthenticated: true,
					userId: 'u1',
					email: 'buyer@example.com',
					subscriptionStatus: 'free',
				}}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		await findEnabledRadio(/^Annual/)
		const button = await screen.findByRole('button', { name: 'Get Premium' })
		await user.click(button)

		await waitFor(() => expect(checkoutOpen).toHaveBeenCalledTimes(1))
		expect(checkoutOpen).toHaveBeenCalledWith({
			items: [{ priceId: 'pri_annual_test', quantity: 1 }],
			settings: {
				displayMode: 'overlay',
				variant: 'one-page',
				successUrl: expect.stringContaining('/welcome'),
			},
			customer: { email: 'buyer@example.com' },
		})
	})

	it('opens checkout with the lifetime price after toggling the plan', async () => {
		stubConfigFetch(CONFIGURED)
		const user = userEvent.setup()
		render(
			<SessionSeedProvider
				seed={{
					isAuthenticated: true,
					userId: 'u1',
					email: 'buyer@example.com',
					subscriptionStatus: 'free',
				}}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		await user.click(await findEnabledRadio(/^Lifetime/))
		await user.click(await screen.findByRole('button', { name: 'Get Premium' }))

		await waitFor(() => expect(checkoutOpen).toHaveBeenCalledTimes(1))
		expect(checkoutOpen).toHaveBeenCalledWith(
			expect.objectContaining({ items: [{ priceId: 'pri_lifetime_test', quantity: 1 }] })
		)
	})

	it('shows an error and never calls Paddle when the environment is not configured', async () => {
		stubConfigFetch({
			isConfigured: false,
			environment: 'sandbox',
			clientToken: null,
			annualPriceId: null,
			lifetimePriceId: null,
		})
		const user = userEvent.setup()
		render(
			<SessionSeedProvider
				seed={{
					isAuthenticated: true,
					userId: 'u1',
					email: 'buyer@example.com',
					subscriptionStatus: 'free',
				}}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		await user.click(await screen.findByRole('button', { name: 'Get Premium' }))

		expect(await screen.findByRole('alert')).toHaveTextContent(/checkout isn't available/i)
		expect(initializePaddle).not.toHaveBeenCalled()
	})
})

describe('PremiumCheckoutButton — already Premium', () => {
	it('shows a status message instead of the checkout toggle for an active subscriber', () => {
		stubConfigFetch(CONFIGURED)
		render(
			<SessionSeedProvider
				seed={{
					isAuthenticated: true,
					userId: 'u1',
					email: 'buyer@example.com',
					subscriptionStatus: 'active',
				}}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		expect(screen.getByText(/already have an active premium subscription/i)).toBeInTheDocument()
		expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Get Premium' })).not.toBeInTheDocument()
	})

	it('shows a status message instead of the checkout toggle for a lifetime holder', () => {
		stubConfigFetch(CONFIGURED)
		render(
			<SessionSeedProvider
				seed={{
					isAuthenticated: true,
					userId: 'u1',
					email: 'buyer@example.com',
					subscriptionStatus: 'lifetime',
				}}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		expect(screen.getByText(/already have lifetime premium access/i)).toBeInTheDocument()
		expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
	})

	it('shows a status message (not the toggle) for a past_due subscriber — a duplicate charge is exactly what this guard prevents', () => {
		stubConfigFetch(CONFIGURED)
		render(
			<SessionSeedProvider
				seed={{
					isAuthenticated: true,
					userId: 'u1',
					email: 'buyer@example.com',
					subscriptionStatus: 'past_due',
				}}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		expect(screen.getByText(/payment issue/i)).toBeInTheDocument()
		expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
	})

	it('still shows the checkout toggle for canceled/free/null statuses — canceled has nothing open, checkout is the correct resubscribe path', () => {
		for (const subscriptionStatus of ['canceled', 'free', null] as const) {
			stubConfigFetch(CONFIGURED)
			const { unmount } = render(
				<SessionSeedProvider
					seed={{
						isAuthenticated: true,
						userId: 'u1',
						email: 'buyer@example.com',
						subscriptionStatus,
					}}
				>
					<PremiumCheckoutButton />
				</SessionSeedProvider>
			)
			expect(screen.getByRole('radiogroup')).toBeInTheDocument()
			unmount()
		}
	})
})

describe('PremiumCheckoutButton — plan toggle a11y', () => {
	it('disables a plan whose price ID is not configured, up front — not just at click-time', async () => {
		stubConfigFetch({
			isConfigured: true,
			environment: 'sandbox',
			clientToken: 'test_client_token',
			annualPriceId: 'pri_annual_test',
			lifetimePriceId: null,
		})
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		await findEnabledRadio(/^Annual/)
		expect(screen.getByRole('radio', { name: /^Lifetime/ })).toBeDisabled()
	})

	it('auto-selects an enabled plan when the DEFAULT selection (annual) is the disabled one — the radiogroup is never entirely keyboard-unreachable', async () => {
		stubConfigFetch({
			isConfigured: true,
			environment: 'sandbox',
			clientToken: 'test_client_token',
			annualPriceId: null,
			lifetimePriceId: 'pri_lifetime_test',
		})
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		const lifetime = await screen.findByRole('radio', { name: /^Lifetime/, checked: true })
		expect(lifetime).toHaveAttribute('tabindex', '0')
		expect(screen.getByRole('radio', { name: /^Annual/ })).toHaveAttribute('tabindex', '-1')
	})

	it('roving tabIndex: only the selected radio is Tab-reachable', async () => {
		stubConfigFetch(CONFIGURED)
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		const annual = await findEnabledRadio(/^Annual/)
		const lifetime = screen.getByRole('radio', { name: /^Lifetime/ })
		expect(annual).toHaveAttribute('tabindex', '0')
		expect(lifetime).toHaveAttribute('tabindex', '-1')
	})

	it('ArrowRight moves BOTH focus and selection to the next plan', async () => {
		stubConfigFetch(CONFIGURED)
		const user = userEvent.setup()
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		const annual = await findEnabledRadio(/^Annual/)
		annual.focus()
		await user.keyboard('{ArrowRight}')

		const lifetime = screen.getByRole('radio', { name: /^Lifetime/ })
		expect(lifetime).toHaveAttribute('aria-checked', 'true')
		expect(lifetime).toHaveFocus()
	})

	it('ArrowRight wraps from the last plan back to the first', async () => {
		stubConfigFetch(CONFIGURED)
		const user = userEvent.setup()
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		const lifetime = await findEnabledRadio(/^Lifetime/)
		lifetime.focus()
		await user.keyboard('{ArrowRight}')

		const annual = screen.getByRole('radio', { name: /^Annual/ })
		expect(annual).toHaveAttribute('aria-checked', 'true')
		expect(annual).toHaveFocus()
	})

	it('ArrowRight skips a disabled (unconfigured-price) plan — proven by NEVER focusing it, not just by landing back on the start', async () => {
		// With two plans, wrapping back is indistinguishable from doing nothing, so spy on `focus`.
		stubConfigFetch({
			isConfigured: true,
			environment: 'sandbox',
			clientToken: 'test_client_token',
			annualPriceId: 'pri_annual_test',
			lifetimePriceId: null,
		})
		const user = userEvent.setup()
		render(
			<SessionSeedProvider
				seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
			>
				<PremiumCheckoutButton />
			</SessionSeedProvider>
		)

		const annual = await findEnabledRadio(/^Annual/)
		const lifetime = screen.getByRole('radio', { name: /^Lifetime/ })
		const annualFocusSpy = vi.spyOn(annual, 'focus')
		const lifetimeFocusSpy = vi.spyOn(lifetime, 'focus')
		annual.focus()
		annualFocusSpy.mockClear()

		await user.keyboard('{ArrowRight}')

		expect(annual).toHaveAttribute('aria-checked', 'true')
		expect(annual).toHaveFocus()
		expect(annualFocusSpy).toHaveBeenCalled()
		expect(lifetimeFocusSpy).not.toHaveBeenCalled()
	})
})

describe('PremiumCheckoutButton — unverified session seed', () => {
	function stubAuthMe(user: unknown, opts: { neverResolves?: boolean } = {}) {
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/paddle/checkout-config')) {
				return Promise.resolve(new Response(JSON.stringify(CONFIGURED), { status: 200 }))
			}
			if (String(input).includes('/api/auth/me')) {
				if (opts.neverResolves) return new Promise(() => {})
				return Promise.resolve(new Response(JSON.stringify({ user }), { status: 200 }))
			}
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch
	}

	it('does NOT offer checkout to a lifetime holder whose seed failed to resolve', async () => {
		stubAuthMe({ subscriptionStatus: 'lifetime' })

		render(<PremiumCheckoutButton />)

		await waitFor(() =>
			expect(screen.getByText(/already have lifetime premium access/i)).toBeInTheDocument()
		)
		expect(screen.queryByRole('button', { name: 'Get Premium' })).not.toBeInTheDocument()
		expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
	})

	it('does NOT offer checkout to an active subscriber whose seed failed to resolve', async () => {
		stubAuthMe({ subscriptionStatus: 'active' })

		render(<PremiumCheckoutButton />)

		await waitFor(() =>
			expect(screen.getByText(/already have an active premium subscription/i)).toBeInTheDocument()
		)
		expect(screen.queryByRole('button', { name: 'Get Premium' })).not.toBeInTheDocument()
	})

	it('offers no checkout WHILE the probe is still in flight', async () => {
		stubAuthMe(null, { neverResolves: true })

		render(<PremiumCheckoutButton />)

		expect(screen.getByText(/checking your account/i)).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Get Premium' })).not.toBeInTheDocument()
		expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
	})

	it('DOES offer checkout once the probe says the visitor is not entitled', async () => {
		stubAuthMe(null)

		render(<PremiumCheckoutButton />)

		await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
		expect(screen.queryByText(/already have/i)).not.toBeInTheDocument()
	})

	it('falls back to offering checkout when the probe itself fails', async () => {
		global.fetch = vi.fn((input: RequestInfo | URL) => {
			if (String(input).includes('/api/paddle/checkout-config')) {
				return Promise.resolve(new Response(JSON.stringify(CONFIGURED), { status: 200 }))
			}
			if (String(input).includes('/api/auth/me')) return Promise.reject(new Error('offline'))
			return Promise.resolve(new Response('{}', { status: 200 }))
		}) as typeof global.fetch

		render(<PremiumCheckoutButton />)

		await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
	})
})
