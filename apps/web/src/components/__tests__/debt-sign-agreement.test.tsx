import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'

const usePremiumAccess = vi.fn()
vi.mock('../../hooks/usePremiumAccess', () => ({
	usePremiumAccess: () => usePremiumAccess(),
}))

const barTotals = vi.hoisted(() => [] as unknown[])
vi.mock('../../lib/balances-bar-data', async (importOriginal) => {
	const real = await importOriginal<typeof import('../../lib/balances-bar-data')>()
	return {
		...real,
		buildBalancesBarData: (...args: Parameters<typeof real.buildBalancesBarData>) => {
			barTotals.push(args[0])
			return real.buildBalancesBarData(...args)
		},
	}
})

import { buildFinancialSummary } from '../../lib/report/build-financial-summary'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { BalancePage } from '../BalancePage'
import { HomePage } from '../HomePage'

const TS = '2026-10-06T00:00:00.000Z'
const DEBT_OWED = 1_500_000

function seed(debtSign: 1 | -1): void {
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-1',
				userId: 0,
				name: 'Salary',
				amount: 300_000,
				frequency: 'monthly',
				categoryId: null,
				createdAt: TS,
				updatedAt: TS,
			},
		],
	})
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	// setState, not addBalanceEntry: the validator refuses a negative debt, so only a bypass creates one.
	useBalanceStore.setState({
		entries: [
			{
				id: 'inv-1',
				type: 'investment',
				name: 'Pension',
				currentBalance: 2_000_000,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: TS,
				updatedAt: TS,
			},
			{
				id: 'debt-1',
				type: 'debt',
				name: 'Car loan',
				currentBalance: debtSign * DEBT_OWED,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: TS,
				updatedAt: TS,
			},
		],
	})
}

function exactText(testId: string): string {
	return (screen.getByTestId(testId).textContent ?? '').trim()
}

type Figures = {
	overviewNetWorth: string
	overviewBarDebts: unknown
	balanceDebtTotal: string
	balanceDebtCell: string | null
	reportNetCents: number
	reportDebtsCents: number
	reportDebtRowCents: number | undefined
}

function readEverySurface(debtSign: 1 | -1): Figures {
	seed(debtSign)
	barTotals.length = 0

	render(<HomePage />)
	const overviewNetWorth = exactText('overview-net-worth')
	const lastBar = barTotals.at(-1) as { debtsCents?: unknown } | undefined
	const overviewBarDebts = lastBar?.debtsCents
	cleanup()

	renderWithProviders(<BalancePage />)
	const balanceDebtTotal = exactText('stat-total-debts')
	const row = screen.getByText('Car loan').closest('tr') as HTMLElement
	const balanceDebtCell = within(row).queryByText(/^-?15,000\.00$/)?.textContent ?? null
	cleanup()

	const report = buildFinancialSummary({
		income: [],
		expenses: [],
		balances: useBalanceStore.getState().entries,
		savings: [],
		generatedAt: new Date(TS),
	})

	return {
		overviewNetWorth,
		overviewBarDebts,
		balanceDebtTotal,
		balanceDebtCell,
		reportNetCents: report.netWorth.netCents,
		reportDebtsCents: report.netWorth.totalDebtsCents,
		reportDebtRowCents: report.netWorth.debts[0]?.balanceCents,
	}
}

const EXPECTED = {
	overviewNetWorth: '5,000.00',
	overviewBarDebts: DEBT_OWED,
	balanceDebtTotal: '15,000.00',
	balanceDebtCell: '15,000.00',
	reportNetCents: 500_000,
	reportDebtsCents: DEBT_OWED,
	reportDebtRowCents: DEBT_OWED,
} satisfies Figures

describe('a debt counts as money owed on every surface', () => {
	beforeEach(() => {
		const status = {
			hasAccess: false,
			subscriptionStatus: 'free',
			isLoading: false,
			error: null,
			isAuthenticated: false,
		} satisfies PremiumAccessStatus
		usePremiumAccess.mockReturnValue({ status })
	})

	afterEach(() => {
		useIncomeStore.setState({ incomeSources: [] })
		useBalanceStore.setState({ entries: [] })
	})

	it('a debt stored +X reads as the hand-computed figures', () => {
		expect(readEverySurface(1)).toEqual(EXPECTED)
	})

	it('the SAME debt stored −X (legacy) reads identically: net worth is not raised', () => {
		const negative = readEverySurface(-1)
		expect(negative).toEqual(EXPECTED)
		expect(negative.overviewNetWorth).not.toBe('35,000.00')
	})
})
