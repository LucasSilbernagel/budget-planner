import type { IncomeBasis, RetirementModel } from '@budget-planner/core/finance/retirement'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
	coerceRetirementPlan,
	RETIREMENT_PLAN_DEFAULTS,
	type RetirementPlan,
} from '../lib/retirement-plan'
import {
	bindRetirementPlanSource,
	cancelPendingPlanPush,
	forgetSyncedPlan,
	schedulePlanPush,
} from '../lib/sync/retirementPlanPush'

export type { RetirementPlan }
export { coerceRetirementPlan, RETIREMENT_PLAN_DEFAULTS }

/** Raw input strings, not parsed numbers, so "not filled in" stays distinct from "entered zero". */

export const RETIREMENT_PLANNER_STORAGE_KEY = 'budget-planner-retirement-planner-v1'

/** The `-v1` in the key is part of the key, not this version; renaming it orphans stored plans. */
export const RETIREMENT_PLANNER_VERSION = 1

/** Matches React's dispatch signature: callers pass updater functions. */
type StringSetter = (value: string | ((previous: string) => string)) => void

type RetirementPlannerStoreState = {
	plan: RetirementPlan
	/** '' = unclaimed. Written only by claimRetirementPlanFor, never by an edit. */
	ownerUserId: string
	/**
	 * Newest server updatedAt seen; sent as the push baseVersion so core keeps a newer local edit.
	 * Persisted only when set.
	 */
	serverUpdatedAt: string | null
	/**
	 * Set when this device holds the plan and the server may not; while set, pulls skip the plan.
	 * No ceiling: expiring it would overwrite the user's work with the older server copy.
	 */
	localPlanDiverged: boolean
	setCurrentAgeInput: StringSetter
	setLifeExpectancyInput: StringSetter
	setDesiredIncomeInput: StringSetter
	/** Value and locale are written together: a value without its locale cannot be safely reparsed. */
	markDesiredIncomeAuthored: (locale: string) => void
	/** Never pushes: its callers rewrite the plan from device-local inputs. */
	setDesiredIncomeForLocale: (value: string, locale: string) => void
	setAdoptedMonthlyCents: (cents: number | null) => void
	setIncomeBasis: (basis: IncomeBasis) => void
	setAnnualReturnInput: StringSetter
	setPostRetirementReturn: StringSetter
	setModel: (model: RetirementModel) => void
	/** Never pushes: Clear local data must not wipe the plan on other devices. */
	resetPlan: () => void
}

function applyString(previous: string, value: string | ((previous: string) => string)): string {
	return typeof value === 'function' ? value(previous) : value
}

export const useRetirementPlannerStore = create<RetirementPlannerStoreState>()(
	persist(
		(set) => ({
			plan: { ...RETIREMENT_PLAN_DEFAULTS },
			ownerUserId: '',
			serverUpdatedAt: null,
			localPlanDiverged: false,

			// Every setter except setDesiredIncomeForLocale and resetPlan schedules a push; a push of an
			// unchanged plan is skipped.
			setCurrentAgeInput: (value) => {
				set((current) => ({
					plan: {
						...current.plan,
						currentAgeInput: applyString(current.plan.currentAgeInput, value),
					},
				}))
				schedulePlanPush()
			},

			setLifeExpectancyInput: (value) => {
				set((current) => ({
					plan: {
						...current.plan,
						lifeExpectancyInput: applyString(current.plan.lifeExpectancyInput, value),
					},
				}))
				schedulePlanPush()
			},

			setDesiredIncomeInput: (value) => {
				set((current) => ({
					plan: {
						...current.plan,
						desiredIncomeInput: applyString(current.plan.desiredIncomeInput, value),
					},
				}))
				schedulePlanPush()
			},

			markDesiredIncomeAuthored: (locale) => {
				set((current) =>
					current.plan.desiredIncomeTouched && current.plan.desiredIncomeLocale === locale
						? current
						: { plan: { ...current.plan, desiredIncomeTouched: true, desiredIncomeLocale: locale } }
				)
				schedulePlanPush()
			},

			setDesiredIncomeForLocale: (value, locale) => {
				set((current) => ({
					plan: { ...current.plan, desiredIncomeInput: value, desiredIncomeLocale: locale },
				}))
			},

			setAdoptedMonthlyCents: (cents) => {
				set((current) =>
					current.plan.adoptedMonthlyCents === cents
						? current
						: { plan: { ...current.plan, adoptedMonthlyCents: cents } }
				)
				schedulePlanPush()
			},

			setIncomeBasis: (basis) => {
				set((current) => ({ plan: { ...current.plan, incomeBasis: basis } }))
				schedulePlanPush()
			},

			setAnnualReturnInput: (value) => {
				set((current) => ({
					plan: {
						...current.plan,
						annualReturnInput: applyString(current.plan.annualReturnInput, value),
					},
				}))
				schedulePlanPush()
			},

			setPostRetirementReturn: (value) => {
				set((current) => ({
					plan: {
						...current.plan,
						postRetirementReturnInput: applyString(current.plan.postRetirementReturnInput, value),
						postRetirementTouched: true,
					},
				}))
				schedulePlanPush()
			},

			setModel: (model) => {
				set((current) => ({ plan: { ...current.plan, model } }))
				schedulePlanPush()
			},

			resetPlan: () => {
				cancelPendingPlanPush()
				forgetSyncedPlan()
				set({ plan: { ...RETIREMENT_PLAN_DEFAULTS }, localPlanDiverged: false })
			},
		}),
		{
			name: RETIREMENT_PLANNER_STORAGE_KEY,
			skipHydration: true,
			partialize: (state) => ({
				plan: state.plan,
				ownerUserId: state.ownerUserId,
				// Only when set, so a never-synced device persists the same bytes.
				...(state.serverUpdatedAt !== null ? { serverUpdatedAt: state.serverUpdatedAt } : {}),
				...(state.localPlanDiverged ? { localPlanDiverged: true } : {}),
			}),
			version: RETIREMENT_PLANNER_VERSION,
			migrate: (persisted) => {
				const serverUpdatedAt = coerceServerUpdatedAt(
					(persisted as { serverUpdatedAt?: unknown } | undefined)?.serverUpdatedAt
				)
				return {
					plan: coerceRetirementPlan((persisted as { plan?: unknown } | undefined)?.plan),
					ownerUserId: coerceOwner(
						(persisted as { ownerUserId?: unknown } | undefined)?.ownerUserId
					),
					...(serverUpdatedAt !== null ? { serverUpdatedAt } : {}),
					...((persisted as { localPlanDiverged?: unknown } | undefined)?.localPlanDiverged === true
						? { localPlanDiverged: true }
						: {}),
				}
			},
			// Runs on every rehydrate (migrate does not at the current version), so this is the
			// corrupt-payload guard: the parsers throw on non-strings.
			merge: (persisted, current) => ({
				...current,
				plan: coerceRetirementPlan((persisted as { plan?: unknown } | undefined)?.plan),
				ownerUserId: coerceOwner((persisted as { ownerUserId?: unknown } | undefined)?.ownerUserId),
				serverUpdatedAt: coerceServerUpdatedAt(
					(persisted as { serverUpdatedAt?: unknown } | undefined)?.serverUpdatedAt
				),
				// `=== true`: localStorage is user-editable, and a `"false"` string is truthy.
				localPlanDiverged:
					(persisted as { localPlanDiverged?: unknown } | undefined)?.localPlanDiverged === true,
			}),
		}
	)
)

/** Only ever used as a baseVersion; a bad one would make core's LWW compare against garbage. */
function coerceServerUpdatedAt(value: unknown): string | null {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

function coerceOwner(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

export const RETIREMENT_PLANNER_PARKED_KEY_PREFIX = `${RETIREMENT_PLANNER_STORAGE_KEY}:`

function readParkedPlan(userId: string): RetirementPlan | null {
	try {
		const raw = localStorage.getItem(`${RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${userId}`)
		return raw === null ? null : coerceRetirementPlan(JSON.parse(raw))
	} catch {
		return null
	}
}

function removeParkedPlan(userId: string): void {
	try {
		localStorage.removeItem(`${RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${userId}`)
	} catch {
		// Blocked storage: nothing was parked either.
	}
}

/** Must run after rehydrate. Plain setState, never an action, so the claim never queues a sync op. */
export function claimRetirementPlanFor(sessionUserId: string): void {
	const { ownerUserId, plan } = useRetirementPlannerStore.getState()
	if (ownerUserId === sessionUserId) {
		return
	}
	cancelPendingPlanPush()
	if (ownerUserId === '') {
		// The session's own parked plan wins over an unclaimed one, which is discarded; otherwise the
		// owner's plan would stay parked for good.
		const parked = sessionUserId === '' ? null : readParkedPlan(sessionUserId)
		if (parked !== null) {
			removeParkedPlan(sessionUserId)
		}
		useRetirementPlannerStore.setState({
			ownerUserId: sessionUserId,
			plan: parked ?? plan,
			serverUpdatedAt: null,
			localPlanDiverged: false,
		})
		forgetSyncedPlan()
		return
	}
	// Park first: if storage refuses, keep the plan on screen rather than lose it.
	try {
		localStorage.setItem(
			`${RETIREMENT_PLANNER_PARKED_KEY_PREFIX}${ownerUserId}`,
			JSON.stringify(plan)
		)
	} catch (error) {
		console.error('[retirementPlanner] could not park the previous owner’s plan:', error)
		return
	}
	const own = sessionUserId === '' ? null : readParkedPlan(sessionUserId)
	if (own !== null) {
		removeParkedPlan(sessionUserId)
	}
	useRetirementPlannerStore.setState({
		ownerUserId: sessionUserId,
		plan: own ?? { ...RETIREMENT_PLAN_DEFAULTS },
		serverUpdatedAt: null,
		localPlanDiverged: false,
	})
	forgetSyncedPlan()
}

// Bound here so the push imports no store.
bindRetirementPlanSource({
	read: () => {
		const { plan, ownerUserId, serverUpdatedAt, localPlanDiverged } =
			useRetirementPlannerStore.getState()
		return { plan, ownerUserId, serverUpdatedAt, localPlanDiverged }
	},
	setDiverged: (localPlanDiverged) => {
		useRetirementPlannerStore.setState({ localPlanDiverged })
	},
})

export const useRetirementPlan = () => useRetirementPlannerStore((state) => state.plan)

export const useSetCurrentAgeInput = () =>
	useRetirementPlannerStore((state) => state.setCurrentAgeInput)

export const useSetLifeExpectancyInput = () =>
	useRetirementPlannerStore((state) => state.setLifeExpectancyInput)

export const useSetDesiredIncomeInput = () =>
	useRetirementPlannerStore((state) => state.setDesiredIncomeInput)

export const useMarkDesiredIncomeAuthored = () =>
	useRetirementPlannerStore((state) => state.markDesiredIncomeAuthored)

export const useSetDesiredIncomeForLocale = () =>
	useRetirementPlannerStore((state) => state.setDesiredIncomeForLocale)

export const useSetAdoptedMonthlyCents = () =>
	useRetirementPlannerStore((state) => state.setAdoptedMonthlyCents)

export const useSetIncomeBasis = () => useRetirementPlannerStore((state) => state.setIncomeBasis)

export const useSetAnnualReturnInput = () =>
	useRetirementPlannerStore((state) => state.setAnnualReturnInput)

export const useSetPostRetirementReturn = () =>
	useRetirementPlannerStore((state) => state.setPostRetirementReturn)

export const useSetModel = () => useRetirementPlannerStore((state) => state.setModel)
