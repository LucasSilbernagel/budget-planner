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
  it('renders a sign-in link to /pricing (returnTo), never opens checkout', async () => {
    stubConfigFetch(CONFIGURED)
    render(
      <SessionSeedProvider
        seed={{ isAuthenticated: false, userId: null, email: null, subscriptionStatus: null }}
      >
        <PremiumCheckoutButton />
      </SessionSeedProvider>
    )

    const link = await screen.findByRole('link', { name: 'Get Premium' })
    expect(link).toHaveAttribute('href', expect.stringContaining('/login'))
    expect(link.getAttribute('href')).toContain('returnTo')
    expect(checkoutOpen).not.toHaveBeenCalled()
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

    await user.click(await screen.findByRole('radio', { name: /^Lifetime/ }))
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
