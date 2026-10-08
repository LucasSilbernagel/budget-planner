// React 19 reports no hydration error for a mismatched node directly under the root, so
// the page is nested with a sibling. Assert on onRecoverableError: with it set React skips console.error.
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { __resetStoresHydratedForTests } from '../../hooks/useStoresHydrated'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { useBalanceStore, useExpenseStore, useIncomeStore, useSavingsStore } from '../../stores'
import { useCurrencyStore } from '../../stores/currencyStore'
import { HomePage } from '../HomePage'

const NOW = '2026-01-01T00:00:00.000Z'

// Must include savings goals: a balance-only seed cannot fail, since both balance selectors are pure.
function seedStores(): void {
  useSavingsStore.setState({
    savingsGoals: [
      {
        id: 'goal-1',
        name: 'Emergency fund',
        targetAmount: 1_000_000,
        currentBalance: 250_000,
        allocationMode: 'manual',
        monthlyAllocation: 20_000,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'goal-2',
        name: 'Rainy day',
        targetAmount: null,
        currentBalance: 50_000,
        allocationMode: 'manual',
        monthlyAllocation: 10_000,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
  useBalanceStore.setState({
    entries: [
      {
        id: 'entry-1',
        type: 'investment',
        name: 'ISA',
        currentBalance: 800_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: 'entry-2',
        type: 'debt',
        name: 'Mortgage',
        currentBalance: 15_000_000,
        monthlyContribution: 0,
        frequency: 'monthly',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'income-1',
        userId: 0,
        name: 'Salary',
        amount: 500_000,
        frequency: 'monthly',
        categoryId: null,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
  useExpenseStore.setState({
    expenses: [
      {
        id: 'expense-1',
        userId: 0,
        name: 'Rent',
        amount: 150_000,
        frequency: 'monthly',
        categoryId: null,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  })
}

let renderingOnClient = false
function Mismatch() {
  return renderingOnClient ? <i>client</i> : <b>server</b>
}

function Document({ withMismatch }: { withMismatch: boolean }) {
  return (
    <div>
      <HomePage />
      {withMismatch && (
        <div>
          <Mismatch />
        </div>
      )}
      <footer>after the page</footer>
    </div>
  )
}

async function hydratePendingOverview(withMismatch: boolean) {
  renderingOnClient = false
  const container = document.createElement('div')
  container.innerHTML = renderToString(<Document withMismatch={withMismatch} />)
  document.body.appendChild(container)
  const serverHtml = container.innerHTML

  seedStores()
  renderingOnClient = true

  const recoverable: string[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, <Document withMismatch={withMismatch} />, {
      onRecoverableError: (error) => recoverable.push(String(error)),
    })
  })
  renderingOnClient = false

  return {
    container,
    serverHtml,
    recoverable,
    cleanup: async () => {
      await act(async () => root?.unmount())
      container.remove()
    },
  }
}

describe('the Overview’s pending markup hydrates into the figures (story 38.2)', () => {
  beforeEach(() => {
    __resetStoresHydratedForTests()
    usePremiumAccess.mockReturnValue({
      status: {
        hasAccess: false,
        isLoading: false,
        error: null,
        subscriptionStatus: null,
      } satisfies Partial<PremiumAccessStatus> as PremiumAccessStatus,
      checkAccess: vi.fn(),
      refresh: vi.fn(),
    })
    useSavingsStore.setState({ savingsGoals: [] })
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useBalanceStore.setState({ entries: [] })
    useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
  })

  it('reports a mismatch when the server and client trees differ (designed-RED control)', async () => {
    const { recoverable, cleanup } = await hydratePendingOverview(true)
    try {
      expect(recoverable.length, 'this harness cannot see a hydration mismatch').toBeGreaterThan(0)
    } finally {
      await cleanup()
    }
  })

  it('hydrates the skeleton markup with no mismatch and resolves to the real net worth', async () => {
    const { container, serverHtml, recoverable, cleanup } = await hydratePendingOverview(false)
    try {
      expect(serverHtml).toContain('overview-net-worth-skeleton')
      expect(serverHtml).not.toContain('$0.00')

      expect(recoverable, `recoverable errors: ${recoverable.join(' | ')}`).toEqual([])
      const figure = container.querySelector('[data-testid="overview-net-worth"]')
      expect(figure?.textContent).toBe('-$139,000.00')
      expect(container.querySelector('[data-testid="overview-net-worth-skeleton"]')).toBeNull()
      expect(container.querySelector('[data-testid="page-loading-status"]')).toBeNull()
    } finally {
      await cleanup()
    }
  })
})
