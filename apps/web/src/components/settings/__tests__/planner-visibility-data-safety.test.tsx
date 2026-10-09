import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
import {
	RETIREMENT_PLANNER_STORAGE_KEY,
	RETIREMENT_PLANNER_VERSION,
} from '../../../stores/retirementPlannerStore'
import { RetirementVisibilityToggle } from '../retirement-visibility-toggle'

const SHARED_KEYS = {
	'budget-planner-income-v1': { state: { incomeSources: [{ id: 'i1', name: 'Salary' }] } },
	'budget-planner-expenses-v1': { state: { expenses: [{ id: 'e1', name: 'Rent' }] } },
	'budget-planner:balance-tracking': { state: { entries: [{ id: 'b1', name: 'ISA' }] } },
	'budget-planner-currency-prefs-v1': { state: { mode: 'symbol', currency: 'USD' } },
} as const

// Values differ from the defaults, so a store that rewrote a fresh blob cannot pass.
const PRESERVED_KEYS = {
	...SHARED_KEYS,
	[RETIREMENT_PLANNER_STORAGE_KEY]: {
		state: {
			plan: {
				currentAgeInput: '42',
				lifeExpectancyInput: '88',
				desiredIncomeInput: '55,000.00',
				desiredIncomeTouched: true,
				desiredIncomeLocale: 'en-US',
				incomeBasis: 'annual',
				annualReturnInput: '7.5',
				postRetirementReturnInput: '3.25',
				postRetirementTouched: true,
				model: 'perpetual',
			},
		},
		// Imported, not a literal: a version bump would otherwise silently route this
		// fixture through `migrate`.
		version: RETIREMENT_PLANNER_VERSION,
	},
} as const

beforeEach(() => {
	usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
	localStorage.clear()
	for (const [key, value] of Object.entries(PRESERVED_KEYS)) {
		localStorage.setItem(key, JSON.stringify(value))
	}
})

afterEach(() => {
	usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
})

describe('hiding the Retirement planner', () => {
	it('leaves every shared store AND the saved plan byte-identical across a hide/show cycle', async () => {
		const user = userEvent.setup()
		const before = Object.fromEntries(
			Object.keys(PRESERVED_KEYS).map((key) => [key, localStorage.getItem(key)])
		)

		render(<RetirementVisibilityToggle />)
		const toggle = screen.getByRole('switch', { name: /show retirement planner/i })

		await user.click(toggle)
		expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(false)
		for (const key of Object.keys(PRESERVED_KEYS)) {
			expect(localStorage.getItem(key), `${key} changed when the planner was hidden`).toBe(
				before[key]
			)
		}

		await user.click(toggle)
		expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
		for (const key of Object.keys(PRESERVED_KEYS)) {
			expect(localStorage.getItem(key), `${key} changed when the planner was restored`).toBe(
				before[key]
			)
		}
	})

	it('writes only its own key', async () => {
		const user = userEvent.setup()
		render(<RetirementVisibilityToggle />)

		await user.click(screen.getByRole('switch', { name: /show retirement planner/i }))

		const touched = Object.keys(localStorage).filter(
			(key) => !(key in PRESERVED_KEYS) && key.startsWith('budget-planner')
		)
		expect(touched).toEqual(['budget-planner-planner-visibility-v1'])
	})
})
