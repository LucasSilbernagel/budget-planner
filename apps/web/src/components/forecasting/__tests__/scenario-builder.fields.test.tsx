import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import type { SavedForecast } from '../saved-forecast'
import { ScenarioBuilder } from '../scenario-builder'

// Assert on the recorded engine calls, not the screen: the summary tiles mask NaN with `|| 0`.

type EngineCall = {
	years: unknown
	incomeGrowthRate: unknown
	expenseGrowthRate: unknown
	incomeAmounts: unknown[]
	eventAmounts: unknown[]
}
const engineCalls = vi.hoisted(() => [] as EngineCall[])

vi.mock('@budget-planner/core/finance/forecasting', async (importOriginal) => {
	const real = await importOriginal<typeof import('@budget-planner/core/finance/forecasting')>()
	return {
		...real,
		calculateFinancialForecast: (
			data: Parameters<typeof real.calculateFinancialForecast>[0],
			scenario: Parameters<typeof real.calculateFinancialForecast>[1],
			years: number
		) => {
			engineCalls.push({
				years,
				incomeGrowthRate: scenario.incomeGrowthRate,
				expenseGrowthRate: scenario.expenseGrowthRate,
				incomeAmounts: data.income.map((i) => i.amount),
				eventAmounts: (scenario.oneTimeEvents ?? []).map((e) => e.amount),
			})
			const finishable = Number.isInteger(years) && years >= 1 && years <= 30
			return real.calculateFinancialForecast(data, scenario, finishable ? years : 1)
		},
	}
})

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
	useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
	useCurrencyMode: () => 'none',
	useCurrencyCode: () => 'NONE',
}))

const ISO = '2026-09-29T00:00:00.000Z'
const PROFILE = 'profile-test'
const GROWTH_MESSAGE = 'Enter a growth rate from -100% to 100%.'
const FIELDS_REASON = 'Fix the highlighted fields to save'
const YEARS_REASON = 'Fix the projection period to save'
const NEGATIVE_MESSAGE = 'Enter an amount of 0 or more.'
const LIMIT_MESSAGE = 'Enter an amount up to 21,474,836.47'
const OVER_LIMIT = '21474836.48'
const NOT_A_NUMBER_MESSAGE = 'Enter a number.'
const SALARY_CENTS = 500_000
const PAST_DEBOUNCE_MS = 700

const rateInRange = (r: unknown) => typeof r === 'number' && Number.isFinite(r) && r >= -1 && r <= 1
const amountOk = (a: unknown) => typeof a === 'number' && Number.isFinite(a) && a >= 0

async function pastDebounce(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS))
	})
}

function statValue(label: string): string {
	const term = screen.getByText(label, { selector: 'dt' })
	return term.nextElementSibling?.textContent ?? ''
}

async function renderBuilder(initialForecast?: SavedForecast): Promise<void> {
	render(<ScenarioBuilder onSave={vi.fn()} initialForecast={initialForecast} />)
	await waitFor(() => expect(engineCalls.length).toBeGreaterThan(0), { timeout: 3000 })
}

function incomeAmountInputs(): HTMLInputElement[] {
	return (screen.getAllByLabelText('Amount') as HTMLInputElement[]).filter(
		(el) => !el.id.startsWith('event-amount-')
	)
}

function expectFieldError(field: HTMLElement, message: string): void {
	expect(field, 'aria-invalid on the field').toHaveAttribute('aria-invalid', 'true')
	const describedBy = field.getAttribute('aria-describedby')
	expect(describedBy, 'aria-describedby on the field').toBeTruthy()
	expect(document.getElementById(describedBy as string)).toHaveTextContent(message)
}

function savedWithIncome(cents: number): SavedForecast {
	return {
		id: 'f-big',
		name: 'Big',
		scenario: {
			name: 'Big',
			incomeGrowthRate: 0,
			expenseGrowthRate: 0,
			newIncome: [{ amount: cents, frequency: 'monthly' }],
		},
		result: {
			scenario: { name: 'Big', incomeGrowthRate: 0, expenseGrowthRate: 0 },
			baseline: [],
			projection: [],
			summary: { startingNetWorth: 1, endingNetWorth: 1, totalGrowth: 0, averageAnnualGrowth: 0 },
		},
		inputs: { savings: 0, investments: 0, years: 5 },
		createdAt: ISO,
		updatedAt: ISO,
	}
}

function expectSaveBlocked(reason: string): void {
	expect(screen.getByTestId('save-blocked-reason')).toHaveTextContent(reason)
	expect(screen.getByRole('button', { name: /save forecast/i })).toBeDisabled()
}

function expectFieldClean(field: HTMLElement): void {
	expect(field).not.toHaveAttribute('aria-invalid')
	expect(field).not.toHaveAttribute('aria-describedby')
}

beforeEach(() => {
	engineCalls.length = 0
	useProfileStore.setState({ activeProfileId: PROFILE })
	useIncomeStore.setState({
		incomeSources: [
			{
				id: 'inc-1',
				profileId: PROFILE,
				userId: 0,
				name: 'Salary',
				amount: SALARY_CENTS,
				frequency: 'monthly',
				categoryId: null,
				createdAt: ISO,
				updatedAt: ISO,
			},
		],
	})
	useExpenseStore.setState({ expenses: [] })
})

afterEach(() => {
	useIncomeStore.setState({ incomeSources: [] })
	vi.clearAllMocks()
})

describe('a growth rate outside -100%..+100%, or not a number, is reported on its field', () => {
	const invalid = [
		['an emptied field', ''],
		['non-numeric text', 'abc'],
		['-150 (below -100%: the income sign would alternate)', '-150'],
		['150 (above +100%)', '150'],
		['trailing junk', '5abc'],
		['an exponent', '1e2'],
		['two commas', '2,5,1'],
		['a grouped number with a decimal comma', '1.000,5'],
		['a grouped number with a decimal point', '1,000.5'],
	] satisfies [string, string][]

	const fields = [
		['Income Growth Rate', 'incomeGrowthRate', 'with an income row'],
		['Expense Growth Rate', 'expenseGrowthRate', 'with NO expense rows'],
	] satisfies [string, 'incomeGrowthRate' | 'expenseGrowthRate', string][]

	for (const [label, key, rows] of fields) {
		for (const [name, typed] of invalid) {
			it(`${label} (${rows}), ${name}: field message, no engine call, Save blocked`, async () => {
				await renderBuilder()
				const callsBefore = engineCalls.length
				const endingBefore = statValue('Ending Net Worth')
				const field = screen.getByLabelText(label)

				fireEvent.change(field, { target: { value: typed } })
				await pastDebounce()

				expect(
					within(field.parentElement as HTMLElement).getByText(GROWTH_MESSAGE)
				).toBeInTheDocument()
				expectFieldError(field, GROWTH_MESSAGE)
				expect(field).toHaveValue(typed)

				expect(
					engineCalls.map((c) => c[key]).filter((r) => !rateInRange(r)),
					`every ${key} the engine was called with must be a finite rate in -1..1`
				).toEqual([])
				expect(engineCalls.length, 'no recompute while a field is invalid').toBe(callsBefore)
				expect(statValue('Ending Net Worth'), 'last good result kept').toBe(endingBefore)
				expect(endingBefore).not.toBe('0.00')
				expect(
					screen.queryByTestId('calculation-error'),
					'no engine banner: the field carries the message'
				).toBeNull()
				expectSaveBlocked(FIELDS_REASON)
			})
		}
	}

	const valid = [
		['-100', -1],
		['100', 1],
		['5', 0.05],
		['5.00%', 0.05],
		['5 %', 0.05],
		['-3.5', -0.035],
		['.5', 0.005],
		['2,5', 0.025],
		['2,5 %', 0.025],
		['-2,5', -0.025],
	] satisfies [string, number][]
	for (const [label, key] of [
		['Income Growth Rate', 'incomeGrowthRate'],
		['Expense Growth Rate', 'expenseGrowthRate'],
	] as const) {
		for (const [typed, rate] of valid) {
			it(`${label}: ${typed} is valid: recomputes with ${rate} and clears the message`, async () => {
				await renderBuilder()
				const field = screen.getByLabelText(label)
				fireEvent.change(field, { target: { value: 'abc' } })
				await pastDebounce()
				expect(screen.getByText(GROWTH_MESSAGE)).toBeInTheDocument()

				const callsBefore = engineCalls.length
				fireEvent.change(field, { target: { value: typed } })
				await waitFor(() => expect(engineCalls.length).toBe(callsBefore + 1), { timeout: 3000 })
				await pastDebounce()
				expect(engineCalls.length, 'one engine call for the corrected value').toBe(callsBefore + 1)

				expect(engineCalls.at(-1)?.[key]).toBeCloseTo(rate, 12)
				expect(field).toHaveValue(typed)
				expect(screen.queryByText(GROWTH_MESSAGE)).toBeNull()
				expectFieldClean(field)
				expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
				expect(screen.getByRole('button', { name: /save forecast/i })).toBeEnabled()
			})
		}
	}
})

describe('an income or expense amount is reported on its field, never silently zeroed', () => {
	const invalid = [
		['a negative', '-5', NEGATIVE_MESSAGE],
		['one cent over the money limit (109.1, Q1)', OVER_LIMIT, LIMIT_MESSAGE],
		['malformed text (109.1: replaces the badInput case)', '1.2.3', NOT_A_NUMBER_MESSAGE],
	] satisfies [string, string, string][]

	for (const [name, typed, message] of invalid) {
		it(`${name}: field message, the typed text stays, the last good amount is kept`, async () => {
			await renderBuilder()
			const callsBefore = engineCalls.length
			const endingBefore = statValue('Ending Net Worth')
			const [amount] = incomeAmountInputs()
			if (!amount) throw new Error('the seeded income row rendered no amount input')

			fireEvent.change(amount, { target: { value: typed } })
			await pastDebounce()

			expectFieldError(amount, message)
			expect(amount.value, 'the typed text is still in the field').toBe(typed)
			expect(
				engineCalls.flatMap((c) => c.incomeAmounts).filter((a) => !amountOk(a)),
				'every income amount the engine saw must be finite and >= 0'
			).toEqual([])
			expect(engineCalls.length, 'no recompute while a field is invalid').toBe(callsBefore)
			expect(statValue('Ending Net Worth')).toBe(endingBefore)
			expect(screen.queryByTestId('calculation-error')).toBeNull()
			expectSaveBlocked(FIELDS_REASON)

			fireEvent.change(amount, { target: { value: '12.34' } })
			await waitFor(() => expect(engineCalls.at(-1)?.incomeAmounts).toEqual([1234]), {
				timeout: 3000,
			})
			expectFieldClean(amount)
			expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
		})
	}

	it('an EXPENSE row is held to the same rule', async () => {
		await renderBuilder()
		fireEvent.click(screen.getByRole('button', { name: /add expense/i }))
		const rows = incomeAmountInputs()
		expect(rows, 'one income row and the new expense row').toHaveLength(2)
		const expense = rows[1] as HTMLInputElement
		fireEvent.change(expense, { target: { value: '40' } })
		await waitFor(() => expect(screen.queryByTestId('save-blocked-reason')).toBeNull())
		await pastDebounce()
		const callsBefore = engineCalls.length

		fireEvent.change(expense, { target: { value: '-40' } })
		await pastDebounce()

		expectFieldError(expense, NEGATIVE_MESSAGE)
		expect(expense.value).toBe('-40')
		expect(engineCalls.length, 'no recompute while a field is invalid').toBe(callsBefore)
		expectSaveBlocked(FIELDS_REASON)
	})

	it('a value that cannot be read (1.2.3) says "Enter a number."', async () => {
		await renderBuilder()
		const callsBefore = engineCalls.length
		const [amount] = incomeAmountInputs()
		if (!amount) throw new Error('the seeded income row rendered no amount input')

		fireEvent.change(amount, { target: { value: '1.2.3' } })
		await pastDebounce()

		expectFieldError(amount, NOT_A_NUMBER_MESSAGE)
		expect(amount.value, 'the typed text stays').toBe('1.2.3')
		fireEvent.blur(amount)
		expect(amount.value).toBe('1.2.3')
		expect(engineCalls.length, 'the last good amount is kept, no recompute').toBe(callsBefore)
		expectSaveBlocked(FIELDS_REASON)
	})

	it('an EMPTIED amount is zero, not an error (a cleared amount means nothing)', async () => {
		await renderBuilder()
		const [amount] = incomeAmountInputs()
		if (!amount) throw new Error('the seeded income row rendered no amount input')

		fireEvent.change(amount, { target: { value: '' } })
		await waitFor(() => expect(engineCalls.at(-1)?.incomeAmounts).toEqual([0]), { timeout: 3000 })
		expectFieldClean(amount)
		expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
	})

	it('removing the row that holds a bad amount lifts the Save block', async () => {
		await renderBuilder()
		fireEvent.click(screen.getByRole('button', { name: /add income/i }))
		const rows = incomeAmountInputs()
		expect(rows).toHaveLength(2)
		const second = rows[1] as HTMLInputElement

		fireEvent.change(second, { target: { value: '-5' } })
		await pastDebounce()
		expectSaveBlocked(FIELDS_REASON)

		const callsBefore = engineCalls.length
		const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
		fireEvent.click(removeButtons[1] as HTMLElement)
		expect(incomeAmountInputs()).toHaveLength(1)
		await waitFor(() =>
			expect(
				screen.queryByTestId('save-blocked-reason'),
				'a removed row must not keep Save blocked'
			).toBeNull()
		)
		await waitFor(() => expect(engineCalls.length).toBeGreaterThan(callsBefore), { timeout: 3000 })
		expect(screen.getByRole('button', { name: /save forecast/i })).toBeEnabled()
	})
})

describe('a one-time event amount that overflows is reported on its field', () => {
	it('over the money limit: field message, the typed text stays, the last good amount is kept', async () => {
		await renderBuilder()
		fireEvent.click(screen.getByRole('button', { name: /add event/i }))
		const amount = document.querySelector('input[id^="event-amount-"]') as HTMLInputElement
		expect(amount, 'the new event row rendered').not.toBeNull()

		fireEvent.change(amount, { target: { value: '12.34' } })
		await waitFor(() => expect(engineCalls.at(-1)?.eventAmounts).toEqual([1234]), {
			timeout: 3000,
		})
		const callsBefore = engineCalls.length

		fireEvent.change(amount, { target: { value: OVER_LIMIT } })
		await pastDebounce()

		expectFieldError(amount, LIMIT_MESSAGE)
		expect(amount.value, 'the typed text is still in the field').toBe(OVER_LIMIT)
		expect(engineCalls.length, 'no recompute while a field is invalid').toBe(callsBefore)
		expectSaveBlocked(FIELDS_REASON)

		fireEvent.change(amount, { target: { value: '20' } })
		await waitFor(() => expect(engineCalls.at(-1)?.eventAmounts).toEqual([2000]), {
			timeout: 3000,
		})
		expectFieldClean(amount)
		expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
	})

	it('text that cannot be read (1.2.3) is reported and held, like an income row', async () => {
		await renderBuilder()
		fireEvent.click(screen.getByRole('button', { name: /add event/i }))
		const amount = document.querySelector('input[id^="event-amount-"]') as HTMLInputElement
		fireEvent.change(amount, { target: { value: '12.34' } })
		await waitFor(() => expect(engineCalls.at(-1)?.eventAmounts).toEqual([1234]), {
			timeout: 3000,
		})
		const callsBefore = engineCalls.length

		fireEvent.change(amount, { target: { value: '1.2.3' } })
		await pastDebounce()

		expectFieldError(amount, NOT_A_NUMBER_MESSAGE)
		expect(engineCalls.length, 'the last amount must not be recomputed silently').toBe(callsBefore)
		expectSaveBlocked(FIELDS_REASON)
	})

	it('clearing an event field after a refused entry writes 0, not the old amount', async () => {
		await renderBuilder()
		fireEvent.click(screen.getByRole('button', { name: /add event/i }))
		const amount = document.querySelector('input[id^="event-amount-"]') as HTMLInputElement
		fireEvent.change(amount, { target: { value: '12.34' } })
		await waitFor(() => expect(engineCalls.at(-1)?.eventAmounts).toEqual([1234]), {
			timeout: 3000,
		})
		fireEvent.change(amount, { target: { value: OVER_LIMIT } })
		fireEvent.change(amount, { target: { value: '' } })

		await waitFor(
			() =>
				expect(
					engineCalls.at(-1)?.eventAmounts,
					'a blank event field must count as 0, not keep the refused-over amount'
				).toEqual([0]),
			{ timeout: 3000 }
		)
		expectFieldClean(amount)
		expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
	})

	it('a refused over-limit `-` entry still selects "Money out" for the corrected entry', async () => {
		await renderBuilder()
		fireEvent.click(screen.getByRole('button', { name: /add event/i }))
		const amount = document.querySelector('input[id^="event-amount-"]') as HTMLInputElement
		const direction = document.querySelector('select[id^="event-direction-"]') as HTMLSelectElement
		fireEvent.change(amount, { target: { value: '12.34' } })
		await waitFor(() => expect(engineCalls.at(-1)?.eventAmounts).toEqual([1234]), {
			timeout: 3000,
		})

		fireEvent.change(amount, { target: { value: `-${OVER_LIMIT}` } })
		expectFieldError(amount, LIMIT_MESSAGE)
		expect(direction.value, 'the typed minus selects money out even when refused').toBe('out')

		fireEvent.change(amount, { target: { value: '5' } })
		await waitFor(
			() =>
				expect(
					engineCalls.at(-1)?.eventAmounts,
					'the corrected entry keeps the minus the user typed'
				).toEqual([-500]),
			{ timeout: 3000 }
		)
	})

	it('on a NEW event (amount 0), a refused over-limit `-` entry still selects "Money out"', async () => {
		// At amount 0 the sign cannot carry the direction, so `pendingDirection` must be set even though the entry is refused.
		await renderBuilder()
		fireEvent.click(screen.getByRole('button', { name: /add event/i }))
		const amount = document.querySelector('input[id^="event-amount-"]') as HTMLInputElement
		const direction = document.querySelector('select[id^="event-direction-"]') as HTMLSelectElement

		fireEvent.change(amount, { target: { value: `-${OVER_LIMIT}` } })
		expectFieldError(amount, LIMIT_MESSAGE)
		expect(direction.value, 'the typed minus selects money out even when refused').toBe('out')

		fireEvent.change(amount, { target: { value: '5' } })
		await waitFor(
			() =>
				expect(
					engineCalls.at(-1)?.eventAmounts,
					'the corrected entry keeps the minus the user typed'
				).toEqual([-500]),
			{ timeout: 3000 }
		)
	})

	it('removing the event that holds a bad amount lifts the Save block', async () => {
		await renderBuilder()
		fireEvent.click(screen.getByRole('button', { name: /add event/i }))
		const amount = document.querySelector('input[id^="event-amount-"]') as HTMLInputElement
		fireEvent.change(amount, { target: { value: OVER_LIMIT } })
		await pastDebounce()
		expectSaveBlocked(FIELDS_REASON)

		const callsBefore = engineCalls.length
		const removeButtons = screen.getAllByRole('button', { name: 'Remove' })
		fireEvent.click(removeButtons.at(-1) as HTMLElement)
		expect(document.querySelector('input[id^="event-amount-"]')).toBeNull()
		await waitFor(() =>
			expect(
				screen.queryByTestId('save-blocked-reason'),
				'a removed event must not keep Save blocked'
			).toBeNull()
		)
		await waitFor(() => expect(engineCalls.length).toBeGreaterThan(callsBefore), { timeout: 3000 })
	})
})

describe('a stale calculation banner is cleared by ANY field turning invalid', () => {
	async function raiseBanner(): Promise<void> {
		await renderBuilder(savedWithIncome(1e308))
		expect(await screen.findByTestId('calculation-error', {}, { timeout: 3000 })).toHaveTextContent(
			'Forecast amounts are too large to project'
		)
	}

	it('a growth rate turning invalid retires the banner', async () => {
		await raiseBanner()
		fireEvent.change(screen.getByLabelText('Expense Growth Rate'), { target: { value: 'abc' } })
		await pastDebounce()
		expect(
			screen.queryByTestId('calculation-error'),
			'a banner about inputs that have since changed must not stay up'
		).toBeNull()
	})

	it('an event amount turning invalid retires the banner', async () => {
		await raiseBanner()
		fireEvent.click(screen.getByRole('button', { name: /add event/i }))
		const amount = document.querySelector('input[id^="event-amount-"]') as HTMLInputElement
		fireEvent.change(amount, { target: { value: '1.2.3' } })
		await pastDebounce()
		expect(
			screen.queryByTestId('calculation-error'),
			'a banner about inputs that have since changed must not stay up'
		).toBeNull()
	})
})

describe('which Save reason shows when several fields are invalid', () => {
	it('the period alone keeps its own reason; the period plus another field shows the general one', async () => {
		await renderBuilder()
		const years = screen.getByLabelText('Projection Period (years)')
		fireEvent.change(years, { target: { value: '31' } })
		await pastDebounce()
		expectSaveBlocked(YEARS_REASON)

		fireEvent.change(screen.getByLabelText('Income Growth Rate'), { target: { value: '' } })
		await pastDebounce()
		expectSaveBlocked(FIELDS_REASON)
	})
})

describe('saved growth rates on load', () => {
	const savedWith = (incomeGrowthRate: unknown): SavedForecast => ({
		id: 'f-1',
		name: 'Plan',
		scenario: {
			name: 'Plan',
			incomeGrowthRate: incomeGrowthRate as number,
			expenseGrowthRate: 0,
			newIncome: [{ amount: SALARY_CENTS, frequency: 'monthly' }],
		},
		result: {
			scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
			baseline: [],
			projection: [],
			summary: {
				startingNetWorth: 1,
				endingNetWorth: 1,
				totalGrowth: 0,
				averageAnnualGrowth: 0,
			},
		},
		inputs: { savings: 100_000, investments: 0, years: 5 },
		createdAt: ISO,
		updatedAt: ISO,
	})

	it('a saved null (a JSON-flattened NaN) opens as 0%, with no field error, and computes with 0', async () => {
		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={savedWith(null)} />)
		await pastDebounce()
		const field = screen.getByLabelText('Income Growth Rate')
		expect(field).toHaveValue('0.00%')
		expect(field, 'a saved null must load as 0, not as an invalid rate').not.toHaveAttribute(
			'aria-invalid'
		)
		expectFieldClean(field)
		expect(engineCalls.at(-1)?.incomeGrowthRate, 'the engine must see 0, not null').toBe(0)
		expect(screen.queryByTestId('calculation-error')).toBeNull()
	})

	it('a saved null EXPENSE growth rate loads as 0% too', async () => {
		const saved = savedWith(0)
		saved.scenario.expenseGrowthRate = null as unknown as number
		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={saved} />)
		await pastDebounce()
		const field = screen.getByLabelText('Expense Growth Rate')
		expect(field).toHaveValue('0.00%')
		expectFieldClean(field)
		expect(engineCalls.at(-1)?.expenseGrowthRate, 'the engine must see 0, not null').toBe(0)
	})

	it('a saved 500% opens with the field error, no engine call with it, and Save blocked', async () => {
		render(<ScenarioBuilder onSave={vi.fn()} initialForecast={savedWith(5)} />)
		await pastDebounce()

		const field = screen.getByLabelText('Income Growth Rate')
		expectFieldError(field, GROWTH_MESSAGE)
		expect(
			engineCalls.map((c) => c.incomeGrowthRate).filter((r) => !rateInRange(r)),
			'a saved out-of-range rate must not reach the engine'
		).toEqual([])
		expectSaveBlocked(FIELDS_REASON)
	})
})
