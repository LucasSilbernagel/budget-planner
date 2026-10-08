/**
 * During hydration zustand hands selectors the initial state, but its methods close over get() and
 * read live state. Asserts on onRecoverableError: supplying it suppresses the console.error path.
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
		monthlyContribution: 0,
		frequency: 'monthly' as const,
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: NOW,
	}
}

/** Stands in for StoreHydration's mount effect. */
function fillStores() {
	useSavingsStore.setState({ savingsGoals: [savingsGoal()] })
	useBalanceStore.setState({ entries: [investmentEntry()] })
}

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

	// Unmount before detaching, or hydrated roots stay subscribed and a later setState renders them
	// outside act.
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

	/** Control: without it, zero errors could mean the harness cannot see a mismatch at all. */
	it('useTotalInvestmentBalance does not diverge either (control)', async () => {
		const { recoverable, serverText, clientText } =
			await hydrateAfterStoresFill(TotalInvestmentsFigure)

		expect(
			recoverable,
			`server rendered "${serverText}", hydration produced "${clientText}"`
		).toEqual([])
	})

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
		useBalanceStore.setState({ entries: [] })
		localStorage.setItem(
			'budget-planner:balance-tracking',
			JSON.stringify({ version: 3, state: { entries: [assetEntry()] } })
		)

		expect(useBalanceStore.getState().entries).toHaveLength(0)

		await useBalanceStore.persist.rehydrate()

		const total = useBalanceStore
			.getState()
			.entries.filter((e) => e.type === 'asset')
			.reduce((sum, e) => sum + e.currentBalance, 0)
		expect(total).toBe(40_000_000)
	})
})
