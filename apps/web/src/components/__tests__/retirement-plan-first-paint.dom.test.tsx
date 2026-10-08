import type React from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from '@/test/utils'
import { useCurrencyStore } from '../../stores/currencyStore'
import {
	RETIREMENT_PLANNER_STORAGE_KEY,
	RETIREMENT_PLANNER_VERSION,
	useRetirementPlannerStore,
} from '../../stores/retirementPlannerStore'
import { RetirementAccumulationPlanner } from '../RetirementAccumulationPlanner'

// Only renderToString (no effects) sees the first paint; RTL and Playwright both hide a flash.
// The plan has no desired income, so the planner shows guidance instead of rendering Recharts.

const SAVED_PLAN = {
	currentAgeInput: '42',
	lifeExpectancyInput: '88',
	desiredIncomeInput: '',
	desiredIncomeTouched: true,
	incomeBasis: 'annual',
	annualReturnInput: '7.5',
	postRetirementReturnInput: '',
	postRetirementTouched: false,
	model: 'deplete',
} as const

function inputValueAttr(container: HTMLElement | Element, id: string): string | null {
	return container.querySelector(`#${id}`)?.getAttribute('value') ?? null
}

beforeEach(() => {
	useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	useRetirementPlannerStore.getState().resetPlan()
	localStorage.removeItem(RETIREMENT_PLANNER_STORAGE_KEY)
})

async function measureFirstPaint(Component: () => React.ReactElement) {
	const container = document.createElement('div')
	container.innerHTML = renderToString(<Component />)
	document.body.appendChild(container)

	const firstPaintAge = inputValueAttr(container, 'currentAge')

	const recoverable: string[] = []
	let root: ReturnType<typeof hydrateRoot> | undefined
	await act(async () => {
		root = hydrateRoot(container, <Component />, {
			onRecoverableError: (error) => recoverable.push(String(error)),
		})
		await useRetirementPlannerStore.persist.rehydrate()
	})

	const settledAge = (container.querySelector('#currentAge') as HTMLInputElement | null)?.value
	await act(async () => {
		root?.unmount()
	})
	container.remove()
	return { firstPaintAge, settledAge, recoverable }
}

describe('first paint of a restored plan (AC-10)', () => {
	it('MEASURED: the first paint shows the DEFAULT age, not the saved one', async () => {
		localStorage.setItem(
			RETIREMENT_PLANNER_STORAGE_KEY,
			JSON.stringify({ state: { plan: SAVED_PLAN }, version: RETIREMENT_PLANNER_VERSION })
		)

		const { firstPaintAge, settledAge, recoverable } = await measureFirstPaint(() => (
			<RetirementAccumulationPlanner />
		))

		// The store is skipHydration, so first paint shows the defaults (35) before the saved 42.
		// Accepted, not fixed: if these numbers change, revisit that decision.
		expect(firstPaintAge).toBe('35')
		expect(settledAge).toBe('42')

		// A value swap, not a hydration mismatch: server and first client render agree.
		expect(recoverable).toEqual([])
	})

	it('shows no swap at all for a first-time user', async () => {
		const { firstPaintAge, settledAge, recoverable } = await measureFirstPaint(() => (
			<RetirementAccumulationPlanner />
		))

		expect(firstPaintAge).toBe('35')
		expect(settledAge).toBe('35')
		expect(recoverable).toEqual([])
	})
})
