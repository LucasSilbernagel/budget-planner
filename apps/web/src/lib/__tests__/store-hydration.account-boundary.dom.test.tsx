/**
 * Asserted as `render` returns: `rehydrate()` is synchronous for localStorage. The
 * `has_session` cookie tells a service-worker-cached document's stale seed from a fresh one.
 */

import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SessionSeed, SIGNED_OUT_SEED } from '../../context/session-seed'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import {
	RETIREMENT_PLAN_DEFAULTS,
	RETIREMENT_PLANNER_STORAGE_KEY,
	useRetirementPlannerStore,
} from '../../stores/retirementPlannerStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { StoreHydration } from '../store-hydration'
import { resetAccountBoundaryForTests } from '../sync/accountBoundary'

const ACCOUNT_A = 'aaaaaaaa-0000-4000-8000-000000000901'
const ACCOUNT_B = 'bbbbbbbb-0000-4000-8000-000000000901'
const A_MAIN = 'aaaaaaaa-1111-4111-8111-111111111901'
const ISO = '2026-10-01T00:00:00.000Z'

const PROFILES_KEY = 'budget-planner-profiles-v1'
const INCOME_KEY = 'budget-planner-income-v1'

function seedFor(
	userId: string,
	subscriptionStatus: SessionSeed['subscriptionStatus']
): SessionSeed {
	return { isAuthenticated: true, userId, email: 'x@example.com', subscriptionStatus }
}

function income(id: string, userId: string | number) {
	return {
		id,
		userId,
		profileId: A_MAIN,
		name: id,
		amount: 100,
		frequency: 'monthly',
		categoryId: null,
		sortOrder: 0,
		createdAt: ISO,
		updatedAt: ISO,
	}
}

const A_PLAN = { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '41', lifeExpectancyInput: '93' }

function leaveAccountAsDataBehind(): void {
	localStorage.setItem(
		PROFILES_KEY,
		JSON.stringify({
			state: {
				profiles: [{ id: A_MAIN, userId: ACCOUNT_A, name: 'A', isDefault: true, currency: 'NONE' }],
				activeProfileId: A_MAIN,
			},
			version: persistVersion(useProfileStore),
		})
	)
	localStorage.setItem(
		INCOME_KEY,
		JSON.stringify({
			state: { incomeSources: [income('a-salary', ACCOUNT_A), income('free-row', 0)] },
			version: persistVersion(useIncomeStore),
		})
	)
	localStorage.setItem(
		RETIREMENT_PLANNER_STORAGE_KEY,
		JSON.stringify({ state: { plan: A_PLAN, ownerUserId: ACCOUNT_A }, version: 1 })
	)
	localStorage.setItem(`bp-sync-queue-${ACCOUNT_A}`, '[{"op":"unsent"}]')
}

function persistVersion(store: { persist: { getOptions: () => { version?: number } } }): number {
	return store.persist.getOptions().version ?? 0
}

function setMarkerCookie(): void {
	document.cookie = 'has_session=1'
}
function clearMarkerCookie(): void {
	document.cookie = 'has_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
}

function incomeIds(): string[] {
	return useIncomeStore.getState().incomeSources.map((row) => row.id)
}

beforeEach(() => {
	localStorage.clear()
	clearMarkerCookie()
	resetAccountBoundaryForTests()
	useIncomeStore.setState({ incomeSources: [] })
	useExpenseStore.setState({ expenses: [] })
	useSavingsStore.setState({ savingsGoals: [] })
	useBalanceStore.getState().reset()
	useCategoryStore.getState().reset()
	useProfileStore.getState().reset()
	useRetirementPlannerStore.setState({ plan: { ...RETIREMENT_PLAN_DEFAULTS }, ownerUserId: '' })
})

afterEach(() => {
	vi.unstubAllGlobals()
	clearMarkerCookie()
})

describe("StoreHydration removes the previous account's data before first paint", () => {
	it('signed out: none of A’s synced rows or profiles, and not A’s plan; free rows stay', () => {
		leaveAccountAsDataBehind()
		render(<StoreHydration seed={{ ...SIGNED_OUT_SEED }} />)

		expect(incomeIds()).toEqual(['free-row'])
		expect(useProfileStore.getState().profiles.some((p) => p.userId === ACCOUNT_A)).toBe(false)
		expect(useRetirementPlannerStore.getState().plan).toEqual(RETIREMENT_PLAN_DEFAULTS)
	})

	it('a free signed-in account B: the same', () => {
		leaveAccountAsDataBehind()
		setMarkerCookie()
		render(<StoreHydration seed={seedFor(ACCOUNT_B, 'free')} />)

		expect(incomeIds()).toEqual(['free-row'])
		expect(useProfileStore.getState().profiles.some((p) => p.userId === ACCOUNT_A)).toBe(false)
		expect(useRetirementPlannerStore.getState().plan).toEqual(RETIREMENT_PLAN_DEFAULTS)
	})

	it('a paid account B: the same, without waiting for the sync engine chunk', () => {
		leaveAccountAsDataBehind()
		setMarkerCookie()
		render(<StoreHydration seed={seedFor(ACCOUNT_B, 'active')} />)

		expect(incomeIds()).toEqual(['free-row'])
		expect(useRetirementPlannerStore.getState().plan).toEqual(RETIREMENT_PLAN_DEFAULTS)
	})

	it('A itself: everything stays', () => {
		leaveAccountAsDataBehind()
		setMarkerCookie()
		render(<StoreHydration seed={seedFor(ACCOUNT_A, 'active')} />)

		expect(incomeIds()).toEqual(['a-salary', 'free-row'])
		expect(useRetirementPlannerStore.getState().plan).toEqual(A_PLAN)
	})

	it('an unverified seed (null) with a marker cookie removes nothing', () => {
		leaveAccountAsDataBehind()
		setMarkerCookie()
		render(<StoreHydration seed={null} />)

		expect(incomeIds()).toEqual(['a-salary', 'free-row'])
		expect(useRetirementPlannerStore.getState().plan).toEqual(A_PLAN)
	})

	it("a cached document still carrying A's seed, on a browser with no marker cookie, is signed out", () => {
		// Offline, the service worker serves a cached document: its seed is stale, the cookie is current.
		leaveAccountAsDataBehind()
		render(<StoreHydration seed={seedFor(ACCOUNT_A, 'active')} />)

		expect(incomeIds()).toEqual(['free-row'])
	})

	it('a signed-out seed on a browser that HAS a marker cookie is unverified: nothing removed', () => {
		leaveAccountAsDataBehind()
		setMarkerCookie()
		render(<StoreHydration seed={{ ...SIGNED_OUT_SEED }} />)

		expect(incomeIds()).toEqual(['a-salary', 'free-row'])
	})

	it('leaves A’s unsent queue alone and makes no request', () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)
		leaveAccountAsDataBehind()
		render(<StoreHydration seed={{ ...SIGNED_OUT_SEED }} />)

		expect(localStorage.getItem(`bp-sync-queue-${ACCOUNT_A}`)).toBe('[{"op":"unsent"}]')
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('persists the removal, so a reload does not bring A’s rows back', () => {
		leaveAccountAsDataBehind()
		render(<StoreHydration seed={{ ...SIGNED_OUT_SEED }} />)

		const saved = JSON.parse(localStorage.getItem(INCOME_KEY) ?? '{}')
		expect(saved.state.incomeSources.map((row: { id: string }) => row.id)).toEqual(['free-row'])
	})
})

describe('the retirement plan follows its owner', () => {
	it('parks A’s plan when someone else’s session loads, and gives it back when A signs in again', () => {
		leaveAccountAsDataBehind()
		render(<StoreHydration seed={{ ...SIGNED_OUT_SEED }} />)
		expect(useRetirementPlannerStore.getState().plan).toEqual(RETIREMENT_PLAN_DEFAULTS)
		expect(localStorage.getItem(`${RETIREMENT_PLANNER_STORAGE_KEY}:${ACCOUNT_A}`)).not.toBeNull()

		resetAccountBoundaryForTests()
		setMarkerCookie()
		render(<StoreHydration seed={seedFor(ACCOUNT_A, 'active')} />)

		expect(useRetirementPlannerStore.getState().plan).toEqual(A_PLAN)
		expect(useRetirementPlannerStore.getState().ownerUserId).toBe(ACCOUNT_A)
		expect(localStorage.getItem(`${RETIREMENT_PLANNER_STORAGE_KEY}:${ACCOUNT_A}`)).toBeNull()
	})

	it('a plan authored signed out survives a signed-out reload and is adopted by whoever signs in', () => {
		const freePlan = { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '30' }
		localStorage.setItem(
			RETIREMENT_PLANNER_STORAGE_KEY,
			JSON.stringify({ state: { plan: freePlan, ownerUserId: '' }, version: 1 })
		)
		render(<StoreHydration seed={{ ...SIGNED_OUT_SEED }} />)
		expect(useRetirementPlannerStore.getState().plan).toEqual(freePlan)

		resetAccountBoundaryForTests()
		setMarkerCookie()
		render(<StoreHydration seed={seedFor(ACCOUNT_B, 'free')} />)
		expect(useRetirementPlannerStore.getState().plan).toEqual(freePlan)
		expect(useRetirementPlannerStore.getState().ownerUserId).toBe(ACCOUNT_B)
	})

	it('B gets B’s own parked plan back, not defaults, when A’s plan is on screen', () => {
		const bPlan = { ...RETIREMENT_PLAN_DEFAULTS, currentAgeInput: '55' }
		leaveAccountAsDataBehind()
		localStorage.setItem(`${RETIREMENT_PLANNER_STORAGE_KEY}:${ACCOUNT_B}`, JSON.stringify(bPlan))
		setMarkerCookie()
		render(<StoreHydration seed={seedFor(ACCOUNT_B, 'active')} />)

		expect(useRetirementPlannerStore.getState().plan).toEqual(bPlan)
		expect(localStorage.getItem(`${RETIREMENT_PLANNER_STORAGE_KEY}:${ACCOUNT_A}`)).not.toBeNull()
	})

	it('a plan edited while signed out does not hide the returning owner’s parked plan', () => {
		leaveAccountAsDataBehind()
		render(<StoreHydration seed={{ ...SIGNED_OUT_SEED }} />)
		useRetirementPlannerStore.getState().setCurrentAgeInput('25')
		expect(useRetirementPlannerStore.getState().ownerUserId).toBe('')

		resetAccountBoundaryForTests()
		setMarkerCookie()
		render(<StoreHydration seed={seedFor(ACCOUNT_A, 'active')} />)

		expect(useRetirementPlannerStore.getState().plan).toEqual(A_PLAN)
		expect(useRetirementPlannerStore.getState().ownerUserId).toBe(ACCOUNT_A)
		expect(localStorage.getItem(`${RETIREMENT_PLANNER_STORAGE_KEY}:${ACCOUNT_A}`)).toBeNull()
	})

	it('a saved plan from before the owner field (no ownerUserId) is nobody’s yet', () => {
		localStorage.setItem(
			RETIREMENT_PLANNER_STORAGE_KEY,
			JSON.stringify({ state: { plan: A_PLAN, ownerUserId: 42 }, version: 1 })
		)
		render(<StoreHydration seed={{ ...SIGNED_OUT_SEED }} />)

		expect(useRetirementPlannerStore.getState().ownerUserId).toBe('')
		expect(useRetirementPlannerStore.getState().plan).toEqual(A_PLAN)
	})
})
