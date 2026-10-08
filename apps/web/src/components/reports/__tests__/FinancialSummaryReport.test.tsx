// Stores use skipHydration, so assert the hydrated render with stores seeded via setState.
// The jsdom setup defaults currency to 'NONE', not $/USD.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBalanceStore } from '../../../stores/balanceStore'
import { useCurrencyStore } from '../../../stores/currencyStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useSavingsStore } from '../../../stores/savingsStore'
import {
	restoreRegionWidths,
	setRegionFits,
	setRegionOverflows,
	stubRegionWidths,
} from '../../../test/region-widths'
import { RESPONSIVE_SCROLL_SHADOW_CLASS, RESPONSIVE_WRAPPER_CLASS } from '../../ui/ResponsiveTable'
import { FinancialSummaryReport } from '../FinancialSummaryReport'

const ISO = '2026-01-01T00:00:00.000Z'
const GENERATED_AT = new Date('2026-08-08T12:00:00.000Z')

const incomeRow = (id: string, name: string, amount: number, frequency: string) => ({
	id,
	userId: 0,
	categoryId: null,
	name,
	amount,
	frequency: frequency as 'weekly' | 'biweekly' | 'monthly' | 'annually',
	createdAt: ISO,
	updatedAt: ISO,
})

const balanceRow = (
	id: string,
	name: string,
	type: 'investment' | 'debt' | 'asset',
	balance: number
) => ({
	id,
	type,
	name,
	currentBalance: balance,
	monthlyContribution: 0,
	frequency: 'monthly' as const,
	createdAt: ISO,
	updatedAt: ISO,
})

const savingsRow = (id: string, name: string, target: number | null, current: number) => ({
	id,
	name,
	targetAmount: target,
	currentBalance: current,
	createdAt: ISO,
	updatedAt: ISO,
})

// Totals are queried via their <dt> because the same figure legitimately repeats on the page.
function totalFor(label: string): HTMLElement {
	// Scoped to `dt` because a label can legitimately also be a section heading —
	// "Net worth" is both the <h2> and the total's term.
	const term = screen.getByText(label, { selector: 'dt' })
	return term.nextElementSibling as HTMLElement
}

const PRINT_BUTTON_NAME = /print \/ save as pdf/i

// Distinguished by article containment, never by array index.
function printButtons(): HTMLElement[] {
	return screen.getAllByRole('button', { name: PRINT_BUTTON_NAME })
}

function topPrintButton(): HTMLElement {
	const button = printButtons().find((element) => !element.closest('#financial-summary-report'))
	if (!button) {
		// Explicit throw: `find` returns undefined, which would otherwise surface as an illegible type error.
		throw new Error('No print button outside #financial-summary-report')
	}
	return button
}

function bottomPrintButton(): HTMLElement {
	const button = printButtons().find((element) => element.closest('#financial-summary-report'))
	if (!button) {
		throw new Error('No print button inside #financial-summary-report')
	}
	return button
}

// Tokens, never substring matches, so a rename cannot turn into a silent pass.
function tokensOf(element: Element): string[] {
	return element.className.split(/\s+/)
}

const ALIGNMENT_TOKEN = /^text-(left|center|right|justify|start|end)$/

// Assert alignment as an exclusive set: Tailwind's last-emitted utility wins at equal
// specificity, so a class string containing text-left can still render centred.
function alignmentTokensOf(element: Element): string[] {
	return tokensOf(element).filter((token) => ALIGNMENT_TOKEN.test(token))
}

function clearStores(): void {
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useBalanceStore.setState({ entries: [] })
	useSavingsStore.setState({ savingsGoals: [] })
}

function seedTypicalData(): void {
	useIncomeStore.setState({
		incomeSources: [
			incomeRow('i1', 'Salary', 500_000, 'monthly'),
			incomeRow('i2', 'Freelance', 10_000, 'weekly'),
		],
	})
	useExpenseStore.setState({
		expenses: [incomeRow('e1', 'Rent', 150_000, 'monthly')],
	})
	useBalanceStore.setState({
		entries: [
			balanceRow('b1', 'ISA', 'investment', 800_000),
			balanceRow('b2', 'Mortgage', 'debt', 15_000_000),
		],
	})
	useSavingsStore.setState({
		savingsGoals: [
			savingsRow('s1', 'Emergency fund', 1_000_000, 250_000),
			savingsRow('s2', 'Rainy day', null, 50_000),
		],
	})
}

const originalFetch = global.fetch

beforeEach(() => {
	vi.clearAllMocks()
	clearStores()
})

afterEach(() => {
	global.fetch = originalFetch
	clearStores()
})

describe('FinancialSummaryReport — content', () => {
	it('is exactly one <main> landmark (story 116.1, FR184)', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		expect(screen.getAllByRole('main')).toHaveLength(1)
	})

	it('renders the monthly-normalized budget totals from the seeded stores', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		// 500000×1 + round(10000 × 52/12) = 500000 + 43333 = 543333 cents.
		// Rendered currency-less (the jsdom default), so grouped digits, no symbol.
		expect(totalFor('Monthly income')).toHaveTextContent('5,433.33')
		expect(totalFor('Monthly expenses')).toHaveTextContent('1,500.00')
		// 543333 − 150000 = 393333 cents.
		expect(totalFor('Monthly surplus')).toHaveTextContent('3,933.33')
	})

	it('renders the per-row entered amount alongside its monthly equivalent', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const freelanceRow = screen.getByRole('rowheader', { name: 'Freelance' }).closest('tr')
		expect(freelanceRow).not.toBeNull()
		const cells = within(freelanceRow as HTMLElement).getAllByRole('cell')
		// Entered weekly 100.00 → 433.33 a month.
		expect(cells[0]).toHaveTextContent('100.00')
		expect(cells[1]).toHaveTextContent('Weekly')
		expect(cells[2]).toHaveTextContent('433.33')
	})

	it('renders net worth with savings added and debts subtracted (story 32.2)', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(totalFor('Total investments')).toHaveTextContent('8,000.00')
		expect(totalFor('Total savings')).toHaveTextContent('3,000.00')
		expect(totalFor('Total debts')).toHaveTextContent('150,000.00')
		// 800000 + 300000 − 15000000 = −13900000 cents. Savings ADD, debts SUBTRACT.
		expect(totalFor('Net worth')).toHaveTextContent('-139,000.00')
		expect(totalFor('Net worth')).not.toHaveTextContent('-142,000.00')
	})

	it('summarizes a savings-only user instead of claiming they have no net worth (story 32.2)', () => {
		useSavingsStore.setState({
			savingsGoals: [savingsRow('s1', 'Emergency fund', 1_000_000, 250_000)],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(totalFor('Net worth')).toHaveTextContent('2,500.00')
		expect(screen.queryByText(/there is no net worth to summarize/i)).not.toBeInTheDocument()
	})

	it('renders savings progress, and a dash where there is no target', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const accountRow = screen.getByRole('rowheader', { name: 'Rainy day' }).closest('tr')
		const accountCells = within(accountRow as HTMLElement).getAllByRole('cell')
		expect(accountCells[1]).toHaveTextContent('—')
		expect(accountCells[2]).toHaveTextContent('—')

		// The untargeted account is excluded from BOTH sides of progress, so overall
		// is 250000/1000000 = 25% — the same figure `/savings` shows for this data.
		expect(totalFor('Overall progress')).toHaveTextContent('25%')
		expect(totalFor('Total saved')).toHaveTextContent('3,000.00')
	})

	// Absence checks are vacuous on the empty branch, so seed data and anchor on the rendered report first.
	// The regexes are broader than the deleted copy so a reworded note cannot return.
	it('renders the generated-at stamp but no currency note or privacy disclaimer', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Financial Summary$/)
		expect(totalFor('Monthly income')).toHaveTextContent('5,433.33')

		// The date stays: a filed printout must be datable. Asserted inside the article, which prints.
		const article = document.querySelector('#financial-summary-report') as HTMLElement
		expect(within(article).getByText(/generated 2026-08-08/i)).toBeInTheDocument()

		expect(document.body.textContent).not.toMatch(/currency/i)
		expect(document.body.textContent).not.toMatch(/amounts\b/i)
		expect(document.body.textContent).not.toMatch(/nothing is sent anywhere to produce it/i)
	})

	it('formats through the selected currency when symbols mode is on (FR34)', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(totalFor('Monthly income')).toHaveTextContent('$5,433.33')

		expect(document.body.textContent).not.toMatch(/currency/i)
		expect(document.body.textContent).not.toMatch(/amounts\b/i)
		expect(document.body.textContent).not.toMatch(/\bUSD\b/i)
		expect(screen.getByText(/generated 2026-08-08/i)).toBeInTheDocument()
	})
})

describe('FinancialSummaryReport — degenerate data states', () => {
	it('states plainly that there is nothing to report when every store is empty', () => {
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		expect(screen.getByText(/there is nothing to report yet/i)).toBeInTheDocument()
		expect(screen.queryByRole('heading', { name: 'Budget' })).not.toBeInTheDocument()
		expect(screen.queryByRole('table')).not.toBeInTheDocument()
	})

	it('explains an individually empty section while other sections still render', () => {
		useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 100_000)] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByRole('heading', { name: 'Budget' })).toBeInTheDocument()
		expect(screen.getByText(/no income or expenses have been added/i)).toBeInTheDocument()
		expect(screen.getByText(/no savings goals or accounts have been added/i)).toBeInTheDocument()
		expect(totalFor('Net worth')).toHaveTextContent('1,000.00')
	})

	it('excludes unreadable rows, discloses the count, and never renders NaN', () => {
		useIncomeStore.setState({
			incomeSources: [
				incomeRow('i1', 'Salary', 500_000, 'monthly'),
				incomeRow('i2', 'Corrupt', 100_000, 'fortnightly'),
			],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText(/1 entry could not be read/i)).toBeInTheDocument()
		expect(screen.queryByRole('rowheader', { name: 'Corrupt' })).not.toBeInTheDocument()
		expect(document.body.textContent).not.toMatch(/NaN/)
		// Only the readable row is counted — the corrupt 100000c is excluded.
		expect(totalFor('Monthly income')).toHaveTextContent('5,000.00')
	})

	it('renders a break-even budget as break-even, not as a shortfall', () => {
		useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 200_000, 'monthly')] })
		useExpenseStore.setState({ expenses: [incomeRow('e1', 'Rent', 200_000, 'monthly')] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText('Monthly net (break-even)')).toBeInTheDocument()
		expect(screen.queryByText('Monthly shortfall')).not.toBeInTheDocument()
	})
})

describe('FinancialSummaryReport — unreadable data is disclosed, not hidden', () => {
	it('does NOT claim there is nothing to report when every row is merely unreadable', () => {
		useIncomeStore.setState({
			incomeSources: [incomeRow('i1', 'Salary', 500_000, 'fortnightly')],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.queryByText(/there is nothing to report yet/i)).not.toBeInTheDocument()
		expect(screen.getByText(/none of your saved entries could be read/i)).toBeInTheDocument()
		expect(screen.getByText(/1 entry could not be read/i)).toBeInTheDocument()
	})

	it('says a section could not be read, rather than that nothing was added', () => {
		useIncomeStore.setState({
			incomeSources: [incomeRow('i1', 'Salary', 500_000, 'fortnightly')],
		})
		useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 100_000)] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText(/none of the entries saved for this section/i)).toBeInTheDocument()
		expect(screen.queryByText(/no income or expenses have been added/i)).not.toBeInTheDocument()
	})

	it('renders a large multi-page data set without crashing or dropping rows', () => {
		useIncomeStore.setState({
			incomeSources: Array.from({ length: 120 }, (_, i) =>
				incomeRow(`i${i}`, `Source ${i}`, 1_000, 'monthly')
			),
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const incomeTable = screen.getByRole('table', { name: /income/i })
		expect(within(incomeTable).getAllByRole('rowheader')).toHaveLength(120)
		expect(totalFor('Monthly income')).toHaveTextContent('1,200.00')
		expect(document.body.textContent).not.toMatch(/NaN/)
	})
})

// Class-token pin, not a layout proof: jsdom has no Tailwind and returns textAlign '' for every <th>.
// Pins both sides to text-left, exclusively (see alignmentTokensOf).
describe('FinancialSummaryReport — table column alignment (story 56.2, UX-DR63)', () => {
	it('left-aligns every row-header cell to match its column header', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const tables = screen.getAllByRole('table')
		// seedTypicalData() yields exactly five tables; a one-table render would assert far less.
		expect(tables).toHaveLength(5)

		for (const table of tables) {
			const caption = table.querySelector('caption')?.textContent ?? '(no caption)'

			const columnHeader = within(table).getAllByRole('columnheader')[0]
			expect(alignmentTokensOf(columnHeader), `${caption}: first column header`).toEqual([
				'text-left',
			])

			// queryAllByRole: getAllByRole throws on zero, making the count check unreachable.
			const rowHeaders = within(table).queryAllByRole('rowheader')
			expect(rowHeaders.length, `${caption}: row header count`).toBeGreaterThan(0)
			for (const cell of rowHeaders) {
				expect(alignmentTokensOf(cell), `${caption}: row header "${cell.textContent}"`).toEqual([
					'text-left',
				])
			}
		}
	})
})

describe('FinancialSummaryReport — printing and privacy', () => {
	it('hands the document to the browser print dialog and nothing else', async () => {
		const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		topPrintButton().click()

		expect(printSpy).toHaveBeenCalledTimes(1)
		printSpy.mockRestore()
	})

	it('makes NO network request to build or print the report (AC-3, NFR1/NFR2)', () => {
		// The privacy claim rests on this: nothing is transmitted.
		const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
		global.fetch = fetchSpy as unknown as typeof global.fetch
		const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})

		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		topPrintButton().click()

		expect(fetchSpy).not.toHaveBeenCalled()
		printSpy.mockRestore()
	})

	it('keeps the top print control out of the printed output', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const button = topPrintButton()
		expect(button.closest('[data-print-hide]')).not.toBeNull()
		// Only the top button sits outside the article; the bottom one relies on data-print-hide alone.
		expect(button.closest('#financial-summary-report')).toBeNull()
	})

	it('keeps the print control at the end of its row now that it stands alone', () => {
		// Row addressed directly (first [data-print-hide] in document order), not via the button,
		// so a second print button cannot hijack this placement assertion.
		seedTypicalData()
		const { container } = render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const row = container.querySelector('[data-print-hide]') as HTMLElement
		expect(row).not.toBeNull()
		const tokens = row.className.split(/\s+/)
		expect(tokens).toEqual(expect.arrayContaining(['flex', 'justify-end']))
		expect(tokens).not.toContain('justify-between')
	})

	it('exposes the report subtree under the id the print stylesheet targets', () => {
		seedTypicalData()
		const { container } = render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		const article = container.querySelector('#financial-summary-report')
		expect(article).not.toBeNull()
		expect(within(article as HTMLElement).getByRole('heading', { level: 1 })).toHaveTextContent(
			/^Financial Summary$/
		)
	})
})

describe('FinancialSummaryReport — bottom print button (story 56.4, FR83)', () => {
	it('offers a second print button at the end of the document (AC-1, AC-4)', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(printButtons()).toHaveLength(2)

		// FOLLOWING is also set for a descendant (CONTAINED_BY | FOLLOWING), so closest('section')
		// must be null to prove the button is at the end of the document.
		const savings = screen.getByRole('heading', { name: 'Savings' }).closest('section')
		expect(savings).not.toBeNull()
		const button = bottomPrintButton()
		expect(
			(savings as HTMLElement).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy()
		expect(button.closest('section')).toBeNull()
	})

	it('gives the bottom button the same row shape as the top one (AC-6)', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		// The top-row guard uses querySelector's first match, so this row needs its own.
		const row = bottomPrintButton().closest('[data-print-hide]') as HTMLElement
		expect(row).not.toBeNull()
		const tokens = tokensOf(row)
		expect(tokens).toEqual(expect.arrayContaining(['flex', 'justify-end']))
		expect(tokens).not.toContain('justify-between')
	})

	it('renders the bottom button in the all-unreadable branch too (AC-5)', () => {
		useIncomeStore.setState({
			incomeSources: [incomeRow('i1', 'Corrupt', 100_000, 'fortnightly')],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText(/none of your saved entries could be read/i)).toBeInTheDocument()
		expect(printButtons()).toHaveLength(2)
	})

	it('hands the document to the print dialog from the bottom button too (AC-4)', () => {
		const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		bottomPrintButton().click()

		expect(printSpy).toHaveBeenCalledTimes(1)
		printSpy.mockRestore()
	})

	it('keeps the bottom button off paper while sitting inside the article (AC-2)', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const button = bottomPrintButton()
		expect(button.closest('[data-print-hide]')).not.toBeNull()
		expect(button.closest('#financial-summary-report')).not.toBeNull()
	})

	it('does not repeat itself on a report with nothing to print (AC-5)', () => {
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText(/there is nothing to report yet/i)).toBeInTheDocument()
		expect(screen.queryAllByRole('button', { name: PRINT_BUTTON_NAME })).toHaveLength(1)
	})

	it('still offers both buttons when the sections exist but hold no figures (AC-5)', () => {
		useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 100_000)] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText(/no income or expenses have been added/i)).toBeInTheDocument()
		expect(printButtons()).toHaveLength(2)
	})

	it('renders the two buttons with identical class attributes (AC-6)', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		// Non-vacuity: two empty class attributes would also compare equal.
		expect(topPrintButton().className).toMatch(/\S/)
		// Equality, not a token spot-check, so no class is left free to drift.
		expect(bottomPrintButton().className).toBe(topPrintButton().className)
	})
})

describe('FinancialSummaryReport — scope (story 30-3, Decision 1)', () => {
	it('does not claim a retirement outlook or a forward projection', () => {
		// Guards the claim, not the token: the net-worth section legitimately says 'This is not a projection'.
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(
			screen.queryByRole('heading', { name: /retirement|projection|forecast/i })
		).not.toBeInTheDocument()

		const text = document.body.textContent ?? ''
		expect(text).not.toMatch(/retirement/i)
		expect(text).not.toMatch(/\bforecast/i)
		expect(text).not.toMatch(/\bprojected\b/i)
		expect(text).not.toMatch(/\byears? from now\b/i)
		expect(screen.getByText(/this is not a projection/i)).toBeInTheDocument()
	})
})

describe('FinancialSummaryReport — net worth copy and savings disclosure (32.2 review)', () => {
	it('names savings in the empty-state sentence', () => {
		// Seed an unrelated section; with every store empty the whole-document empty state shows instead.
		useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 500_000, 'monthly')] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		expect(
			screen.getByText(/no investments, savings, assets or debts have been added/i)
		).toBeInTheDocument()
		expect(
			screen.queryByText(
				'No investments or debts have been added, so there is no net worth to summarize.'
			)
		).not.toBeInTheDocument()
	})

	it('discloses savings entries excluded from the net-worth figure', () => {
		useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 800_000)] })
		useSavingsStore.setState({
			savingsGoals: [savingsRow('s1', 'Corrupt', null, Number.NaN)],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(
			screen.getByText(/1 savings entry could not be read and is not included in this net worth/i)
		).toBeInTheDocument()
	})

	it('does not claim nothing was added when the only savings rows are unreadable', () => {
		useSavingsStore.setState({
			savingsGoals: [savingsRow('s1', 'Corrupt', null, Number.NaN)],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(
			screen.queryByText(/no investments, savings or debts have been added/i)
		).not.toBeInTheDocument()
		expect(
			screen.getByText(/1 savings entry could not be read and is not included in this net worth/i)
		).toBeInTheDocument()
	})
})

describe('FinancialSummaryReport — corrupt savings targets are disclosed (32.2 review)', () => {
	it('explains that a balance counted but its target could not be read', () => {
		useSavingsStore.setState({
			savingsGoals: [savingsRow('s1', 'Legacy goal', 0, 100_000)],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(totalFor('Total saved')).toHaveTextContent('1,000.00')
		expect(
			screen.getByText(
				/target could not be read, so its balance is included but its progress is not shown/i
			)
		).toBeInTheDocument()
	})

	it('says nothing when every target is readable', () => {
		useSavingsStore.setState({
			savingsGoals: [
				savingsRow('s1', 'Emergency fund', 1_000_000, 250_000),
				savingsRow('s2', 'Rainy day', null, 50_000),
			],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.queryByText(/target could not be read/i)).not.toBeInTheDocument()
	})
})

describe('FinancialSummaryReport — assets are printed, not just counted (Story 43.4, FR70)', () => {
	it('renders an Assets table and a Total assets row that reconcile with net worth', () => {
		useBalanceStore.setState({
			entries: [
				balanceRow('b1', 'ISA', 'investment', 5_000_000),
				balanceRow('b2', 'Condo', 'asset', 40_000_000),
				balanceRow('b3', 'Mortgage', 'debt', 30_000_000),
			],
		})

		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText('Assets')).toBeInTheDocument()
		expect(screen.getByText('Condo')).toBeInTheDocument()

		// 5,000,000 + 0 savings + 40,000,000 − 30,000,000 = 15,000,000.
		const totalAssets = screen.getByText('Total assets')
		expect(totalAssets.parentElement).toHaveTextContent('400,000.00')
		const netWorthRows = screen.getAllByText('Net worth')
		expect(netWorthRows.some((el) => el.parentElement?.textContent?.includes('150,000.00'))).toBe(
			true
		)
	})

	it('does not report a valid asset row as unreadable', () => {
		useBalanceStore.setState({ entries: [balanceRow('b1', 'Condo', 'asset', 40_000_000)] })

		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.queryByText(/could not be read/i)).toBeNull()
		const netWorthRows = screen.getAllByText('Net worth')
		expect(netWorthRows.some((el) => el.parentElement?.textContent?.includes('400,000.00'))).toBe(
			true
		)
	})
})

// Every assertion must cross a state change (monthly is the default) and re-anchor on rendered
// figures after the switch. Annual expectations are hand-computed literals.
describe('FinancialSummaryReport — Budget period toggle (story 56.3, FR84)', () => {
	function periodControl(): HTMLSelectElement {
		return screen.getByRole('combobox', { name: /show the budget per/i }) as HTMLSelectElement
	}

	function columnHeaders(tableName: RegExp): HTMLElement[] {
		return within(screen.getByRole('table', { name: tableName })).getAllByRole('columnheader')
	}

	function cellsOfRow(name: string): HTMLElement[] {
		const row = screen.getByRole('rowheader', { name }).closest('tr')
		expect(row).not.toBeNull()
		return within(row as HTMLElement).getAllByRole('cell')
	}

	function expectReportStillRendered(): void {
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Financial Summary$/)
		expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
	}

	it('defaults to monthly, leaving the figures and labels unchanged (AC-1)', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(periodControl().value).toBe('monthly')
		expect(columnHeaders(/income/i)[3]).toHaveTextContent('Monthly')
		expect(totalFor('Monthly income')).toHaveTextContent('5,433.33')
		expect(totalFor('Monthly expenses')).toHaveTextContent('1,500.00')
		expect(totalFor('Monthly surplus')).toHaveTextContent('3,933.33')
		expect(
			screen.getByText(/every entry is converted to a monthly figure so the totals are comparable/i)
		).toBeInTheDocument()
	})

	it('re-words the conversion note so the printed page cannot contradict itself', async () => {
		const user = userEvent.setup()
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		await user.selectOptions(periodControl(), 'annually')
		expectReportStillRendered()

		const article = document.querySelector('#financial-summary-report') as HTMLElement
		expect(within(article).getByText(/converted to a yearly figure/i)).toBeInTheDocument()
		expect(within(article).queryByText(/converted to a monthly figure/i)).not.toBeInTheDocument()

		// The existing reserved-word guards only render the monthly wording.
		expect(document.body.textContent).not.toMatch(/currency/i)
		expect(document.body.textContent).not.toMatch(/amounts\b/i)
	})

	it('annualizes the derived column and all three totals when switched (AC-3, AC-4)', async () => {
		const user = userEvent.setup()
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		await user.selectOptions(periodControl(), 'annually')
		expectReportStillRendered()

		// Column header flips — scoped to the table, because the option list also
		// contains the word and a page-wide getByText would match it instead.
		expect(columnHeaders(/income/i)[3]).toHaveTextContent('Annual')
		expect(columnHeaders(/expenses/i)[3]).toHaveTextContent('Annual')

		// Per-row derived figures: monthly ×12, as literals.
		// Salary   500,000c/mo → 6,000,000c   Freelance 43,333c/mo → 519,996c
		expect(cellsOfRow('Salary')[2]).toHaveTextContent('60,000.00')
		expect(cellsOfRow('Freelance')[2]).toHaveTextContent('5,199.96')

		// Totals relabel AND revalue. 543,333×12 / 150,000×12 / 393,333×12.
		expect(totalFor('Annual income')).toHaveTextContent('65,199.96')
		expect(totalFor('Annual expenses')).toHaveTextContent('18,000.00')
		expect(totalFor('Annual surplus')).toHaveTextContent('47,199.96')

		expect(screen.queryByText('Monthly income', { selector: 'dt' })).not.toBeInTheDocument()
	})

	it('leaves the entered Amount and Frequency columns untouched (AC-5)', async () => {
		const user = userEvent.setup()
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(cellsOfRow('Freelance')[0]).toHaveTextContent('100.00')
		expect(cellsOfRow('Freelance')[1]).toHaveTextContent('Weekly')

		await user.selectOptions(periodControl(), 'annually')
		expectReportStillRendered()

		expect(cellsOfRow('Freelance')[0]).toHaveTextContent('100.00')
		expect(cellsOfRow('Freelance')[1]).toHaveTextContent('Weekly')
		expect(cellsOfRow('Freelance')[2]).toHaveTextContent('5,199.96')
	})

	it('keeps the status word when relabelling a break-even budget (AC-4)', async () => {
		const user = userEvent.setup()
		useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 200_000, 'monthly')] })
		useExpenseStore.setState({ expenses: [incomeRow('e1', 'Rent', 200_000, 'monthly')] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText('Monthly net (break-even)')).toBeInTheDocument()

		await user.selectOptions(periodControl(), 'annually')
		expectReportStillRendered()

		expect(screen.getByText('Annual net (break-even)')).toBeInTheDocument()
		expect(screen.queryByText('Annual shortfall')).not.toBeInTheDocument()
		expect(screen.queryByText('Annual surplus')).not.toBeInTheDocument()
	})

	it('keeps the status word when relabelling a deficit budget (AC-4)', async () => {
		const user = userEvent.setup()
		useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 100_000, 'monthly')] })
		useExpenseStore.setState({ expenses: [incomeRow('e1', 'Rent', 200_000, 'monthly')] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByText('Monthly shortfall')).toBeInTheDocument()

		await user.selectOptions(periodControl(), 'annually')
		expectReportStillRendered()

		expect(screen.getByText('Annual shortfall')).toBeInTheDocument()
		// −100,000c/mo × 12.
		expect(totalFor('Annual shortfall')).toHaveTextContent('-12,000.00')
	})

	it('leaves the Net Worth and Savings sections alone (AC-6)', async () => {
		const user = userEvent.setup()
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const before = {
			netWorth: totalFor('Net worth').textContent,
			investments: totalFor('Total investments').textContent,
			saved: totalFor('Total saved').textContent,
			progress: totalFor('Overall progress').textContent,
		}
		expect(before.netWorth).toMatch(/-139,000\.00/)
		expect(before.saved).toMatch(/3,000\.00/)

		await user.selectOptions(periodControl(), 'annually')
		expectReportStillRendered()
		expect(totalFor('Annual income')).toHaveTextContent('65,199.96')

		expect(totalFor('Net worth').textContent).toBe(before.netWorth)
		expect(totalFor('Total investments').textContent).toBe(before.investments)
		expect(totalFor('Total saved').textContent).toBe(before.saved)
		expect(totalFor('Overall progress').textContent).toBe(before.progress)
	})

	it('keeps the control off the printed page while the figures print (AC-7)', () => {
		seedTypicalData()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		// Reached via the control: querySelector('[data-print-hide]') returns the print-button row.
		const hidden = periodControl().closest('[data-print-hide]')
		expect(hidden).not.toBeNull()

		expect(periodControl().closest('#financial-summary-report')).not.toBeNull()
	})

	// The fixture is the whole test: round figures round-trip exactly. Here 10,000c → 833c → 9,996c
	// and 100,001c → 8,333c → 99,996c.
	it('shows the entered figure when the period IS the row’s own cadence', async () => {
		const user = userEvent.setup()
		useIncomeStore.setState({
			incomeSources: [
				incomeRow('i1', 'Insurance', 10_000, 'annually'),
				incomeRow('i2', 'Bonus', 100_001, 'annually'),
				incomeRow('i3', 'Freelance', 10_000, 'weekly'),
			],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		await user.selectOptions(periodControl(), 'annually')
		expectReportStillRendered()

		expect(cellsOfRow('Insurance')[2]).toHaveTextContent('100.00')
		expect(cellsOfRow('Bonus')[2]).toHaveTextContent('1,000.01')
		expect(cellsOfRow('Insurance')[2]).not.toHaveTextContent('99.96')
		expect(cellsOfRow('Bonus')[2]).not.toHaveTextContent('999.96')

		// A weekly row has no entered annual figure, so it still converts.
		expect(cellsOfRow('Freelance')[2]).toHaveTextContent('5,199.96')

		await user.selectOptions(periodControl(), 'monthly')
		expect(cellsOfRow('Insurance')[2]).toHaveTextContent('8.33')
		expect(cellsOfRow('Freelance')[2]).toHaveTextContent('433.33')
	})

	it('is absent when the budget has no figures to re-express', () => {
		// Only a seeded balance, so the Budget section renders its empty branch.
		useBalanceStore.setState({ entries: [balanceRow('b1', 'ISA', 'investment', 100_000)] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(screen.getByRole('heading', { name: 'Budget' })).toBeInTheDocument()
		expect(screen.getByText(/no income or expenses have been added/i)).toBeInTheDocument()
		expect(screen.queryByRole('combobox', { name: /show the budget per/i })).not.toBeInTheDocument()
	})
})

// jsdom computes no layout: this pins the wiring, not that it fits.
describe('section totals break only between digit groups (story 88.4)', () => {
	function runsOf(el: Element): string[] {
		const out = ['']
		for (const node of Array.from(el.childNodes)) {
			if (node.nodeName === 'WBR') out.push('')
			else out[out.length - 1] += node.textContent ?? ''
		}
		return out
	}

	afterEach(() => {
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
		useIncomeStore.setState({ incomeSources: [] })
		useBalanceStore.setState({ entries: [] })
		useSavingsStore.setState({ savingsGoals: [] })
	})

	it('money totals carry a break after each group separator; percent and dash do not', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'USD' })
		useIncomeStore.setState({
			incomeSources: [incomeRow('i1', 'Salary', 1_280_246_790, 'monthly')],
		})
		useBalanceStore.setState({
			entries: [balanceRow('b1', 'Brokerage', 'investment', 1_234_567_890)],
		})
		useSavingsStore.setState({ savingsGoals: [savingsRow('s1', 'Rainy day', null, 1_322_222_190)] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(runsOf(totalFor('Monthly income'))).toEqual(['$12,', '802,', '467.90'])
		expect(runsOf(totalFor('Total investments'))).toEqual(['$12,', '345,', '678.90'])
		// 12,345,678.90 + 13,222,221.90
		expect(runsOf(totalFor('Net worth'))).toEqual(['$25,', '567,', '900.80'])
		expect(runsOf(totalFor('Total saved'))).toEqual(['$13,', '222,', '221.90'])
		expect(runsOf(totalFor('Total target'))).toEqual(['—'])
		expect(runsOf(totalFor('Overall progress'))).toEqual(['—'])
	})

	it('every total row: the label shrinks first and the value is right-aligned (D7, 88.4 review)', () => {
		// jsdom has no layout or Tailwind: this pins the class tokens only.
		useIncomeStore.setState({ incomeSources: [incomeRow('i1', 'Salary', 100_00, 'monthly')] })
		useBalanceStore.setState({ entries: [balanceRow('b1', 'Brokerage', 'investment', 100_00)] })
		useSavingsStore.setState({ savingsGoals: [savingsRow('s1', 'Rainy day', null, 100_00)] })
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		for (const label of [
			'Monthly income',
			'Total investments',
			'Net worth',
			'Total saved',
			'Total target',
			'Overall progress',
		]) {
			const dd = totalFor(label)
			const dt = dd.previousElementSibling as HTMLElement
			expect(dt.tagName, label).toBe('DT')
			expect(dt.className.split(/\s+/), label).toContain('shrink-[1000]')
			expect(dd.className.split(/\s+/), label).toContain('text-right')
			expect((dd.parentElement as HTMLElement).className.split(/\s+/), label).toContain('gap-4')
		}
	})

	it('a percent total renders unchanged, with no break (story 88.4)', () => {
		useCurrencyStore.setState({ mode: 'symbol', currency: 'EUR' })
		useSavingsStore.setState({
			savingsGoals: [savingsRow('s1', 'Roof', 4_000_000_00, 1_000_000_00)],
		})
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		expect(runsOf(totalFor('Overall progress'))).toEqual(['25%'])
		// EUR (de-DE): the group separator is ".", and the break follows it.
		// (de-DE puts a NO-BREAK space before the symbol.)
		expect(runsOf(totalFor('Total saved'))).toEqual(['1.', '000.', '000,00\u00a0€'])
	})
})

// jsdom computes no layout: these pin the wiring; geometry is pinned by the report CI screenshots.
describe('the report fits the screen and keeps its columns in print (story 91.2)', () => {
	afterEach(() => {
		restoreRegionWidths()
	})

	function seedEveryTable(): void {
		seedTypicalData()
		useBalanceStore.setState({
			entries: [
				balanceRow('b1', 'ISA', 'investment', 800_000),
				balanceRow('b2', 'Mortgage', 'debt', 15_000_000),
				balanceRow('b3', 'Car', 'asset', 900_000),
			],
		})
	}

	function regionsOf(): HTMLElement[] {
		return screen.getAllByRole('table').map((table) => table.parentElement as HTMLElement)
	}

	it('wraps each of the six tables in its own signposted, keyboard-reachable scroll region', () => {
		seedEveryTable()
		// A region is a Tab stop only while it scrolls; jsdom reports every width as 0, so stub them.
		stubRegionWidths()
		setRegionOverflows()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)

		const regions = regionsOf()
		expect(regions).toHaveLength(6)
		const labels = new Set<string>()
		for (const region of regions) {
			const caption = region.querySelector('caption')?.textContent ?? '(no caption)'
			expect(region.tagName, caption).toBe('DIV')
			expect(region.querySelectorAll('table'), caption).toHaveLength(1)
			for (const token of [
				...RESPONSIVE_WRAPPER_CLASS.split(/\s+/),
				...RESPONSIVE_SCROLL_SHADOW_CLASS.split(/\s+/),
			]) {
				expect(tokensOf(region), `${caption}: ${token}`).toContain(token)
			}
			expect(region, caption).toHaveAttribute('tabindex', '0')
			expect(region, caption).toHaveAttribute('role', 'region')
			const label = region.getAttribute('aria-label') ?? ''
			expect(label, caption).toMatch(/\S/)
			// Page-wide guards forbid these words (see BUDGET_PERIOD_LABEL_TEXT).
			expect(label, caption).not.toMatch(/currency|amounts\b/i)
			labels.add(label)
			// The gap above the table moved to the region: on the table it would sit
			// INSIDE the scroll box, under the shadow covers.
			expect(tokensOf(region), caption).toContain('mt-3')
			expect(tokensOf(region.querySelector('table') as HTMLElement), caption).not.toContain('mt-3')
		}
		expect(labels.size, 'every region has a distinct name').toBe(6)
	})

	it('a table that fits is not a Tab stop, but keeps its region role and name (93.1)', () => {
		seedEveryTable()
		stubRegionWidths()
		setRegionFits()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		const regions = regionsOf()
		expect(regions).toHaveLength(6)
		for (const region of regions) {
			const caption = region.querySelector('caption')?.textContent ?? '(no caption)'
			expect(region.hasAttribute('tabindex'), caption).toBe(false)
			expect(region, caption).toHaveAttribute('role', 'region')
			expect(region.getAttribute('aria-label') ?? '', caption).toMatch(/\S/)
		}
	})

	it('the regions never clip or paint in print: overflow visible, no background', () => {
		seedEveryTable()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		for (const region of regionsOf()) {
			const caption = region.querySelector('caption')?.textContent ?? '(no caption)'
			expect(tokensOf(region), caption).toContain('print:overflow-visible')
			expect(tokensOf(region), caption).toContain('print:bg-none')
		}
	})

	it('a long name can wrap anywhere, on screen and on paper, in every table', () => {
		seedEveryTable()
		render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		const rowHeaders = screen.getAllByRole('rowheader')
		expect(rowHeaders).toHaveLength(8)
		for (const cell of rowHeaders) {
			expect(tokensOf(cell), cell.textContent ?? '').toContain('[overflow-wrap:anywhere]')
			expect(tokensOf(cell), cell.textContent ?? '').toContain('max-sm:min-w-[8rem]')
			expect(
				tokensOf(cell).filter((t) => t.startsWith('print:')),
				cell.textContent ?? ''
			).toEqual([])
		}
	})

	it('the page column fills the window instead of growing to its widest table', () => {
		seedEveryTable()
		const { container } = render(<FinancialSummaryReport generatedAt={GENERATED_AT} />)
		const shell = container.firstElementChild as HTMLElement
		expect(shell.querySelector('#financial-summary-report')).not.toBeNull()
		for (const token of ['w-full', 'mx-auto', 'max-w-3xl']) {
			expect(tokensOf(shell)).toContain(token)
		}
	})
})
