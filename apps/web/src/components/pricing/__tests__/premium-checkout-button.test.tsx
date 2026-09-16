/**
 * PremiumCheckoutButton tests (Story 5-3, Task 2a).
 *
 * NFR8: all Paddle calls are mocked — `@paddle/paddle-js`'s `initializePaddle`
 * never runs for real, and `/api/paddle/checkout-config` is a stubbed
 * `fetch`, not a live network call.
 */

import { SessionSeedProvider } from '@/context/session-seed'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetPaddleInstanceForTests } from '../../../lib/paddle/checkout'
import { PremiumCheckoutButton } from '../premium-checkout-button'

const checkoutOpen = vi.fn()
const pricePreview = vi.fn()
const initializePaddle = vi.fn()

vi.mock('@paddle/paddle-js', () => ({
  initializePaddle: (...args: unknown[]) => initializePaddle(...args),
}))

const originalFetch = global.fetch

const CONFIGURED = {
  isConfigured: true,
  environment: 'sandbox' as const,
  clientToken: 'test_client_token',
  annualPriceId: 'pri_annual_test',
  lifetimePriceId: 'pri_lifetime_test',
}

/** A realistic-shaped `Paddle.PricePreview()` response for both catalog prices. */
const PRICE_PREVIEW_RESPONSE = {
  data: {
    details: {
      lineItems: [
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
 * Both radios render from the very first paint but stay `disabled` until
 * `/api/paddle/checkout-config` settles, so `findByRole` alone resolves
 * against the PRE-config render. Any assertion about `disabled`, focus or
 * selection is a coin flip on fetch timing unless it waits for the
 * post-config state first (this is what failed in CI on 2026-09-16).
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

    // Static fallback first (before the config fetch + PricePreview resolve) —
    // and no breakdown yet, since the fallback isn't a real quoted price.
    expect(screen.getByRole('radio', { name: 'Annual · €39/yr' })).toBeInTheDocument()
    expect(screen.queryByText(/tax/i)).not.toBeInTheDocument()
    // …then Paddle's own formatted total once PricePreview resolves, plus the
    // subtotal+tax=total breakdown for the SELECTED (annual, default) plan —
    // this is what turns "why is this €44.07, not €39" (the report that
    // prompted it) into a visible fact instead of a bare reassurance.
    expect(await screen.findByRole('radio', { name: 'Annual · €44.07' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Lifetime · €111.87' })).toBeInTheDocument()
    expect(screen.getByText('€39.00 + €5.07 tax = €44.07')).toBeInTheDocument()

    // No country/address is passed — Paddle auto-detects from the visitor IP.
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

describe('PremiumCheckoutButton — signed out', () => {
  it('opens checkout directly with no pre-filled email — NOT gated behind sign-in', async () => {
    // Regression test: checkout used to require isAuthenticated, which made it
    // impossible for a brand-new customer to ever reach it (magic-link login
    // only re-authenticates an EXISTING account; account creation happens at
    // the Paddle webhook, on a COMPLETED checkout — a circular dependency).
    stubConfigFetch(CONFIGURED)
    const user = userEvent.setup()
    render(
      <SessionSeedProvider
        seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
      >
        <PremiumCheckoutButton />
      </SessionSeedProvider>
    )

    // Checkout can only open once the config fetch has landed, so wait for
    // the configured (enabled) radiogroup before clicking.
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

    // Checkout can only open once the config fetch has landed, so wait for
    // the configured (enabled) radiogroup before clicking.
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
    // Regression: `plan` defaults to 'annual'. If ONLY the annual price ID is
    // missing, the old logic left `tabIndex={0}` on the disabled annual radio
    // and -1 on the enabled lifetime radio — no radio in the group was ever
    // Tab-reachable at all.
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

    // The Lifetime radio is present from the very first render (both options
    // always render; only `disabled` depends on config), so `findByRole`
    // alone would resolve before the config fetch settles and the
    // auto-correction effect runs. Wait for the corrected state explicitly.
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
    // With only two plans, "skips the disabled one and wraps back to the
    // start" is indistinguishable from "the handler did nothing at all" by
    // outcome alone — deleting the keydown handler entirely would leave this
    // exact assertion green (caught by the 2026-09-15 #3 review). Spy on
    // `focus` directly to prove `handleRadioKeyDown`'s logic actually ran
    // and specifically chose the enabled option, rather than merely never
    // having moved.
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
    // The handler DID run and DID choose a target — it just landed back on
    // the only enabled option, since Lifetime is disabled.
    expect(annualFocusSpy).toHaveBeenCalled()
    expect(lifetimeFocusSpy).not.toHaveBeenCalled()
  })
})

/**
 * Story 5-19, AC-5 — the client half of the already-Premium guard.
 *
 * A `null` seed does NOT mean "signed out": `getSessionSeed` returns an
 * authoritative signed-out seed for that, and `null` ONLY when it could not
 * verify the session at all. The old guard read `seed?.subscriptionStatus`
 * directly, so an unverified seed belonging to an `active` or `lifetime`
 * subscriber fell straight through to a live "Get Premium" button — a guard
 * against a real duplicate charge that defaulted to offering the purchase.
 */
describe('PremiumCheckoutButton — unverified session seed (5-19 AC-5)', () => {
  /** `/api/auth/me` answers with `user`; checkout-config stays configured. */
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
    // The exact fall-through this AC closes: rendered with NO provider (seed
    // null), the pre-5-19 component showed a live "Get Premium" to this user.
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
    // The fail-open direction mattered most here: an unresolved probe used to
    // render the live CTA immediately.
    stubAuthMe(null, { neverResolves: true })

    render(<PremiumCheckoutButton />)

    expect(screen.getByText(/checking your account/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Get Premium' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  })

  it('DOES offer checkout once the probe says the visitor is not entitled', async () => {
    // The complement: a brand-new customer must never be locked out of buying
    // by this guard, or it would be a worse bug than the one it fixes.
    stubAuthMe(null)

    render(<PremiumCheckoutButton />)

    await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument())
    expect(screen.queryByText(/already have/i)).not.toBeInTheDocument()
  })

  it('falls back to offering checkout when the probe itself fails', async () => {
    // A failed probe must not permanently block purchases — the SERVER guard
    // in `/api/paddle/checkout-config` is the authoritative one and refuses an
    // entitled session regardless of what the client believes.
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
