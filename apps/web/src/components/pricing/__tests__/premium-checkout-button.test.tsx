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
import { PremiumCheckoutButton } from '../premium-checkout-button'

const checkoutOpen = vi.fn()
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

function stubConfigFetch(config: unknown) {
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes('/api/paddle/checkout-config')) {
      return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  }) as typeof global.fetch
}

beforeEach(() => {
  checkoutOpen.mockReset()
  initializePaddle.mockReset()
  initializePaddle.mockResolvedValue({ Checkout: { open: checkoutOpen } })
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('PremiumCheckoutButton — signed out', () => {
  it('renders a sign-in link to /pricing (returnTo), never calls Paddle', async () => {
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
    expect(initializePaddle).not.toHaveBeenCalled()
  })
})

describe('PremiumCheckoutButton — signed in', () => {
  it('opens checkout with the annual price by default, pre-filling the signed-in email', async () => {
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

    await user.click(await screen.findByRole('radio', { name: 'Lifetime · €99' }))
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
