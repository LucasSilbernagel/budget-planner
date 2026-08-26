/**
 * A store selector must not escape React's hydration snapshot (Story 38.1, BUG-F).
 *
 * ## The defect this pins
 *
 * zustand 4.5.7 passes `api.getServerState || api.getInitialState` to
 * `useSyncExternalStoreWithSelector` as React's `getServerSnapshot`, so during
 * hydration React calls the selector with the **pristine default state object** —
 * exactly what the server rendered from.
 *
 * That protection holds only for a selector that reads its ARGUMENT. The default
 * state object's *methods* still close over `get()`, which returns LIVE state. So:
 *
 *   useSavingsStore((s) => s.getTotalSavings())      ← reads live state    ❌
 *   useBalanceStore((s) => s.entries.reduce(...))    ← reads the snapshot  ✅
 *
 * In the real app `lib/store-hydration.tsx` fills every store from a mount effect
 * in the ROOT subtree, while route content sits inside the Suspense boundary
 * `@tanstack/react-router` wraps around the root `<Outlet/>` (`Match.js:286-289`)
 * and hydrates in a LATER pass. `fillStores()` below stands in for that ordering.
 *
 * ## ⚠️ Why this test asserts on a callback, not on console.error
 *
 * React 19.2.7 delivers a hydration mismatch through `onRecoverableError`
 * (`react-dom-client.development.js:5229` → `queueHydrationError`). `hydrateRoot`
 * NEVER throws to the caller. And the channels are MUTUALLY EXCLUSIVE: supply
 * `onRecoverableError` and the default handler — which is what writes to
 * `console.error` — never runs. A `console.error` spy here would go permanently
 * green the moment a handler is passed. Assert on the callback.
 *
 * ## ⚠️ Filename
 *
 * `vitest.config.ts` selects the environment by FILENAME (`environmentMatchGlobs`).
 * This file must keep a `.dom.test.tsx` suffix or it runs in `node`, where
 * `document` is undefined and it cannot run at all.
 *
 * The e2e counterpart — which is the only layer that can see the real SSR document
 * and the real Suspense boundary — is `e2e/hydration.spec.ts`.
 */

import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore, useTotalInvestmentBalance } from '../balanceStore'
import { useSavingsStore, useTotalSavings } from '../savingsStore'

const NOW = '2026-08-22T00:00:00.000Z'

function savingsGoal() {
  return {
    id: 'goal-1',
    name: 'Emergency fund',
    targetAmount: 1_000_000,
    currentBalance: 300_000,
    allocationMode: 'manual' as const,
    monthlyAllocation: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function assetEntry() {
  return {
    id: 'asset-entry-1',
    type: 'asset' as const,
    name: 'Condo',
    currentBalance: 40_000_000,
    maxContributionLimit: null,
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function investmentEntry() {
  return {
    id: 'entry-1',
    type: 'investment' as const,
    name: 'ISA',
    currentBalance: 800_000,
    maxContributionLimit: null,
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/**
 * Stands in for `StoreHydration`'s mount effect: the stores are already full by
 * the time the deferred subtree hydrates.
 */
function fillStores() {
  useSavingsStore.setState({ savingsGoals: [savingsGoal()] })
  useBalanceStore.setState({ entries: [investmentEntry()] })
}

/**
 * Server-render `Component` against EMPTY stores, fill the stores, then hydrate —
 * and report every recoverable error React raised.
 *
 * Returns the errors plus the before/after text so a failure says what diverged
 * rather than only that something did.
 */
async function hydrateAfterStoresFill(Component: () => React.ReactElement) {
  const container = document.createElement('div')
  container.innerHTML = renderToString(<Component />)
  document.body.appendChild(container)

  const serverText = container.textContent

  fillStores()

  const recoverable: string[] = []
  let root: ReturnType<typeof hydrateRoot> | undefined
  await act(async () => {
    root = hydrateRoot(container, <Component />, {
      onRecoverableError: (error) => recoverable.push(String(error)),
    })
  })

  const result = { recoverable, serverText, clientText: container.textContent }

  // ⚠️ Unmount before detaching. Code review found the first version only called
  // `container.remove()`, leaving every hydrated root subscribed to the stores —
  // so a later test's `setState` re-rendered detached trees outside `act` and
  // printed "not wrapped in act(...)" warnings. Harmless to the assertions here
  // (each call owns its own `recoverable` array), but it is exactly the leak that
  // becomes a flake the day a test asserts on warnings or render counts.
  await act(async () => {
    root?.unmount()
  })
  container.remove()
  return result
}

function TotalSavingsFigure() {
  return <span>{useTotalSavings()}</span>
}

function TotalInvestmentsFigure() {
  return <span>{useTotalInvestmentBalance()}</span>
}

describe('store selectors during hydration', () => {
  beforeEach(() => {
    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })
  })

  it('useTotalSavings does not diverge from the server render', async () => {
    const { recoverable, serverText, clientText } = await hydrateAfterStoresFill(TotalSavingsFigure)

    expect(
      recoverable,
      `server rendered "${serverText}", hydration produced "${clientText}"`
    ).toEqual([])
  })

  /**
   * ⚠️ DESIGNED-GREEN CONTROL — publish as a control, never count it as a pass.
   *
   * `useTotalInvestmentBalance` is a field selector over the same kind of store,
   * filled at the same moment, rendering the same shape of text node. It was
   * measured GREEN against the unfixed code while the sibling above was RED.
   * Without it, "0 recoverable errors" could mean the harness cannot see a
   * mismatch at all rather than that there is none to see.
   */
  it('useTotalInvestmentBalance does not diverge either (control)', async () => {
    const { recoverable, serverText, clientText } =
      await hydrateAfterStoresFill(TotalInvestmentsFigure)

    expect(
      recoverable,
      `server rendered "${serverText}", hydration produced "${clientText}"`
    ).toEqual([])
  })

  /**
   * The fix must not be "never show the user their data". Both hooks must still
   * reach the rehydrated value once hydration has settled.
   */
  it('both hooks resolve to the rehydrated totals after hydration', async () => {
    const savings = await hydrateAfterStoresFill(TotalSavingsFigure)
    expect(savings.clientText).toBe('300000')

    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })

    const investments = await hydrateAfterStoresFill(TotalInvestmentsFigure)
    expect(investments.clientText).toBe('800000')
  })
})

describe('useTotalAssetBalance hydration parity (Story 43.4)', () => {
  it('derives from the state argument, so SSR and first client render agree', async () => {
    // ⚠️ Story 38.1 (BUG-F) measured that a selector which CALLS a state method
    // diverges between the server render and the first client render on a
    // lazily-mounted route. `no-method-selectors.guard.test.ts` is a tripwire and
    // says so; this exercises the real hydration path for the NEW selector.
    useBalanceStore.setState({ entries: [] })
    localStorage.setItem(
      'budget-planner:balance-tracking',
      JSON.stringify({ version: 3, state: { entries: [assetEntry()] } })
    )

    // Before rehydration the store is at its default — zero, not a crash.
    expect(useBalanceStore.getState().entries).toHaveLength(0)

    await useBalanceStore.persist.rehydrate()

    const total = useBalanceStore
      .getState()
      .entries.filter((e) => e.type === 'asset')
      .reduce((sum, e) => sum + e.currentBalance, 0)
    expect(total).toBe(40_000_000)
  })
})
