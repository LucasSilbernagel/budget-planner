import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, renderWithProviders, screen, within } from '@/test/utils'
import { useCurrencyStore } from '../../stores/currencyStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useOverviewDurationStore } from '../../stores/overviewDurationStore'
import { ExpensesPage } from '../ExpensesPage'
import { IncomePage } from '../IncomePage'

const base = {
	userId: 0,
	categoryId: null,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
}

const MIXED_INCOME = [
	{
		id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		name: 'Side gig',
		amount: 20000,
		frequency: 'weekly' as const,
		...base,
	},
	{
		id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		name: 'Salary',
		amount: 150000,
		frequency: 'monthly' as const,
		...base,
	},
	{
		id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
		name: 'Bonus',
		amount: 60000,
		frequency: 'annually' as const,
		...base,
	},
]

const MIXED_EXPENSES = [
	{
		id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
		name: 'Groceries',
		amount: 5000,
		frequency: 'weekly' as const,
		...base,
	},
	{
		id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
		name: 'Rent',
		amount: 90000,
		frequency: 'monthly' as const,
		...base,
	},
	{
		id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
		name: 'Insurance',
		amount: 120000,
		frequency: 'annually' as const,
		...base,
	},
]

const PERIOD_WORD = {
	weekly: 'week',
	biweekly: '2 weeks',
	monthly: 'month',
	annually: 'year',
} satisfies Record<'weekly' | 'biweekly' | 'monthly' | 'annually', string>

const incomeSelector = () => screen.getByRole('combobox', { name: /show income per/i })
const expenseSelector = () => screen.getByRole('combobox', { name: /show expenses per/i })

const totalCard = (labelPattern: RegExp): HTMLElement =>
	screen.getByRole('heading', { name: labelPattern }).parentElement as HTMLElement

beforeEach(() => {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useOverviewDurationStore.setState({ duration: 'annually' })
})

afterEach(() => {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useOverviewDurationStore.setState({ duration: 'annually' })
})

describe('IncomePage — Total Income is frequency-correct and period-labelled', () => {
	it('states the period in the visible label rather than leaving it implicit', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })
		renderWithProviders(<IncomePage />)

		expect(screen.getByRole('heading', { name: 'Total Income (per year)' })).toBeInTheDocument()
	})

	it('shows the frequency-normalized total, not the raw sum', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })
		useOverviewDurationStore.setState({ duration: 'monthly' })
		renderWithProviders(<IncomePage />)

		const card = totalCard(/^Total Income \(per month\)$/)
		expect(within(card).getByText('2,416.67')).toBeInTheDocument()
		expect(within(card).queryByText('2,300.00')).not.toBeInTheDocument()
	})

	it('re-expresses the total at every one of the four durations', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })
		renderWithProviders(<IncomePage />)

		expect(within(totalCard(/per year/)).getByText('29,000.04')).toBeInTheDocument()

		fireEvent.change(incomeSelector(), { target: { value: 'monthly' } })
		expect(within(totalCard(/per month/)).getByText('2,416.67')).toBeInTheDocument()

		fireEvent.change(incomeSelector(), { target: { value: 'weekly' } })
		expect(within(totalCard(/per week/)).getByText('557.69')).toBeInTheDocument()

		fireEvent.change(incomeSelector(), { target: { value: 'biweekly' } })
		expect(within(totalCard(/per 2 weeks/)).getByText('1,115.39')).toBeInTheDocument()
	})

	it('offers all four entry frequencies as options', () => {
		renderWithProviders(<IncomePage />)

		const options = Array.from((incomeSelector() as HTMLSelectElement).options)
		expect(options.map((o) => o.value)).toEqual(['weekly', 'biweekly', 'monthly', 'annually'])
		expect(options.map((o) => o.textContent)).toEqual([
			'Weekly',
			'Bi-weekly',
			'Monthly',
			'Annually',
		])
	})

	// act() matters: a bare setState on a mounted component leaves the DOM stale.
	it('renders a zero total with no NaN at each of the four durations', () => {
		renderWithProviders(<IncomePage />)

		for (const duration of ['weekly', 'biweekly', 'monthly', 'annually'] as const) {
			act(() => {
				useOverviewDurationStore.setState({ duration })
			})
			const card = totalCard(new RegExp(`^Total Income \\(per ${PERIOD_WORD[duration]}\\)$`))
			expect(within(card).getByText('0.00')).toBeInTheDocument()
			expect(card.textContent).not.toMatch(/NaN/)
		}
	})

	it('discloses the conversion when it changed the figure', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })
		renderWithProviders(<IncomePage />)

		expect(
			screen.getByRole('button', { name: /more information about the income figure/i })
		).toBeInTheDocument()
	})

	it('does NOT disclose when every row is already monthly (nothing was converted)', () => {
		useIncomeStore.setState({ incomeSources: [MIXED_INCOME[1]] })
		renderWithProviders(<IncomePage />)

		expect(
			screen.queryByRole('button', { name: /more information about the income figure/i })
		).not.toBeInTheDocument()
	})

	it('DOES disclose for a single-frequency user whose one frequency is not monthly', () => {
		useIncomeStore.setState({ incomeSources: [MIXED_INCOME[0]] })
		renderWithProviders(<IncomePage />)

		expect(
			screen.getByRole('button', { name: /more information about the income figure/i })
		).toBeInTheDocument()
	})

	it('DOES disclose when conversion lands coincidentally on the raw sum', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					...base,
					id: '11111111-1111-4111-8111-111111111111',
					name: 'Weekly',
					amount: 33000,
					frequency: 'weekly',
				},
				{
					...base,
					id: '22222222-2222-4222-8222-222222222222',
					name: 'Annual',
					amount: 120000,
					frequency: 'annually',
				},
			],
		})
		useOverviewDurationStore.setState({ duration: 'monthly' })
		renderWithProviders(<IncomePage />)

		expect(within(totalCard(/per month/)).getByText('1,530.00')).toBeInTheDocument()
		expect(
			screen.getByRole('button', { name: /more information about the income figure/i })
		).toBeInTheDocument()
	})
})

describe('ExpensesPage — Total Expenses is frequency-correct and period-labelled', () => {
	it('shows the frequency-normalized total, not the raw sum', () => {
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })
		useOverviewDurationStore.setState({ duration: 'monthly' })
		renderWithProviders(<ExpensesPage />)

		const card = totalCard(/^Total Expenses \(per month\)$/)
		expect(within(card).getByText('1,216.67')).toBeInTheDocument()
		expect(within(card).queryByText('2,150.00')).not.toBeInTheDocument()
	})

	it('re-expresses the total at every one of the four durations', () => {
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })
		renderWithProviders(<ExpensesPage />)

		expect(within(totalCard(/per year/)).getByText('14,600.04')).toBeInTheDocument()

		fireEvent.change(expenseSelector(), { target: { value: 'monthly' } })
		expect(within(totalCard(/per month/)).getByText('1,216.67')).toBeInTheDocument()

		fireEvent.change(expenseSelector(), { target: { value: 'weekly' } })
		expect(within(totalCard(/per week/)).getByText('280.77')).toBeInTheDocument()

		fireEvent.change(expenseSelector(), { target: { value: 'biweekly' } })
		expect(within(totalCard(/per 2 weeks/)).getByText('561.54')).toBeInTheDocument()
	})
	it('renders a zero total with no NaN when there are no rows', () => {
		renderWithProviders(<ExpensesPage />)

		const card = totalCard(/^Total Expenses \(per year\)$/)
		expect(within(card).getByText('0.00')).toBeInTheDocument()
		expect(card.textContent).not.toMatch(/NaN/)
	})

	it('discloses the conversion when it changed the figure', () => {
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })
		renderWithProviders(<ExpensesPage />)

		expect(
			screen.getByRole('button', { name: /more information about the expenses figure/i })
		).toBeInTheDocument()
	})

	it('does NOT disclose when every row is already monthly', () => {
		useExpenseStore.setState({ expenses: [MIXED_EXPENSES[1]] })
		renderWithProviders(<ExpensesPage />)

		expect(
			screen.queryByRole('button', { name: /more information about the expenses figure/i })
		).not.toBeInTheDocument()
	})

	it('excludes and discloses an unreadable row', () => {
		useExpenseStore.setState({
			expenses: [
				MIXED_EXPENSES[1],
				{
					...base,
					id: '33333333-3333-4333-8333-333333333333',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
				},
			],
		})
		useOverviewDurationStore.setState({ duration: 'monthly' })
		renderWithProviders(<ExpensesPage />)

		expect(within(totalCard(/per month/)).getByText('900.00')).toBeInTheDocument()
		expect(screen.getByTestId('unreadable-rows-note')).toHaveTextContent(
			/1 entry could not be read and is not included/i
		)
	})
})

describe('the duration selection is one app-wide source of truth', () => {
	it('a change on the Income page is reflected on the Expenses page', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })
		useExpenseStore.setState({ expenses: MIXED_EXPENSES })

		const { unmount } = renderWithProviders(<IncomePage />)
		fireEvent.change(incomeSelector(), { target: { value: 'weekly' } })
		unmount()

		renderWithProviders(<ExpensesPage />)
		expect(screen.getByRole('heading', { name: 'Total Expenses (per week)' })).toBeInTheDocument()
		expect((expenseSelector() as HTMLSelectElement).value).toBe('weekly')
	})

	it('the selection survives a remount (it lives in the persisted store)', () => {
		const { unmount } = renderWithProviders(<IncomePage />)
		fireEvent.change(incomeSelector(), { target: { value: 'biweekly' } })
		unmount()

		renderWithProviders(<IncomePage />)
		expect((incomeSelector() as HTMLSelectElement).value).toBe('biweekly')
	})
})

describe('unreadable rows are excluded and disclosed, never silently dropped', () => {
	it('discloses the excluded row instead of under-reporting in silence', () => {
		useIncomeStore.setState({
			incomeSources: [
				MIXED_INCOME[1],
				{
					...base,
					id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
				},
			],
		})
		useOverviewDurationStore.setState({ duration: 'monthly' })
		renderWithProviders(<IncomePage />)

		expect(screen.getByTestId('unreadable-rows-note')).toHaveTextContent(
			/1 entry could not be read and is not included/i
		)
	})

	it('renders the page at all with a corrupt row (it used to be able to throw)', () => {
		useIncomeStore.setState({
			incomeSources: [
				{
					...base,
					id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
					name: 'Corrupt',
					amount: 10000,
					frequency: 'daily' as never,
				},
			],
		})

		// validateFrequency throws; without the readable-rows guard this render white-screens.
		expect(() => renderWithProviders(<IncomePage />)).not.toThrow()
		expect(screen.getByRole('heading', { level: 1, name: 'Income Sources' })).toBeInTheDocument()
	})

	it('shows no disclosure when every row is readable', () => {
		useIncomeStore.setState({ incomeSources: MIXED_INCOME })
		renderWithProviders(<IncomePage />)

		expect(screen.queryByTestId('unreadable-rows-note')).not.toBeInTheDocument()
	})
})

describe('the total is formatted in the locale its currency implies', () => {
	afterEach(() => {
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	})

	// de-DE puts U+00A0 before the symbol; normalise it so the expectations stay readable.
	const shownTotal = () =>
		(screen.getByTestId('period-total-amount').textContent ?? '').replace(/\s/g, ' ')

	it.each([
		['symbol', 'EUR', 100_000, '1.000,00 €'],
		['symbol', 'USD', 100_000, '$1,000.00'],
		['none', 'NONE', 100_000, '1,000.00'],
		// A retained symbol currency under currency-less mode is reachable; raw numbers stay en-US.
		['none', 'EUR', 123_456_789, '1,234,567.89'],
		['none', 'INR', 123_456_789, '1,234,567.89'],
	] as const)('%s mode with %s shows %i cents as %s', (mode, currency, amount, expected) => {
		useCurrencyStore.setState({ mode, currency })
		useOverviewDurationStore.setState({ duration: 'monthly' })
		useIncomeStore.setState({ incomeSources: [{ ...MIXED_INCOME[1], amount }] })
		renderWithProviders(<IncomePage />)

		expect(shownTotal()).toBe(expected)
	})
})
