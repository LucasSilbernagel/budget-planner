/**
 * Store-free on purpose: the sync bridge imports this, and a bridge → store import is a cycle that deadlocks concurrent imports.
 * The field set must match the sync push schema; a test pins them key for key.
 */

import {
	INCOME_BASES,
	type IncomeBasis,
	RETIREMENT_MODELS,
	type RetirementModel,
} from '@budget-planner/core'

export type RetirementPlan = {
	/** `''` is "cleared", which is not the same as absent. */
	currentAgeInput: string
	lifeExpectancyInput: string
	desiredIncomeInput: string
	/** Stops the income-derived prefill effect, which re-fires after every rehydrate, from overwriting a saved value. */
	desiredIncomeTouched: boolean
	/** Locale the input was formatted in; without it a currency change reparses '55.000,00' as $55. */
	desiredIncomeLocale: string
	incomeBasis: IncomeBasis
	annualReturnInput: string
	postRetirementReturnInput: string
	/** Until set, the field mirrors the accumulation rate. One-way latch: clearing the field is still an edit. */
	postRetirementTouched: boolean
	/**
	 * Persisted so an adopted value is re-expressed when the basis changes, even after the route unmounts.
	 * No version bump needed: coerceRetirementPlan defaults it to null.
	 */
	adoptedMonthlyCents: number | null
	model: RetirementModel
}

/** The post-retirement rate starts empty: a literal would end the mirror on first render. */
export const RETIREMENT_PLAN_DEFAULTS: RetirementPlan = {
	currentAgeInput: '35',
	lifeExpectancyInput: '90',
	desiredIncomeInput: '',
	desiredIncomeTouched: false,
	adoptedMonthlyCents: null,
	desiredIncomeLocale: '',
	incomeBasis: 'annual',
	annualReturnInput: '6.0',
	postRetirementReturnInput: '',
	postRetirementTouched: false,
	model: 'deplete',
}

// Shared with the sync push gate so a value added to one can't be refused by the other.
const VALID_MODELS: readonly RetirementModel[] = RETIREMENT_MODELS
const VALID_INCOME_BASES: readonly IncomeBasis[] = INCOME_BASES

/** typeof check, not `||`: absent → default, but '' (cleared) must be preserved. */
function readField(record: Record<string, unknown>, field: keyof RetirementPlan): unknown {
	// Own-property check keeps a `__proto__` key out.
	return Object.hasOwn(record, field) ? record[field] : undefined
}

function coerceString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback
}

/** A safe integer whose ×12 is also safe: it reaches toAnnualIncomeCents, which throws outside that range. */
export function coerceAdoptedCents(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		return null
	}
	return Number.isSafeInteger(value * 12) ? value : null
}

function coerceMember<T extends string>(value: unknown, valid: readonly T[], fallback: T): T {
	return valid.includes(value as T) ? (value as T) : fallback
}

export function coerceRetirementPlan(value: unknown): RetirementPlan {
	const record =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {}

	const d = RETIREMENT_PLAN_DEFAULTS
	const postRetirementTouched = coerceBoolean(
		readField(record, 'postRetirementTouched'),
		d.postRetirementTouched
	)

	return {
		currentAgeInput: coerceString(readField(record, 'currentAgeInput'), d.currentAgeInput),
		lifeExpectancyInput: coerceString(
			readField(record, 'lifeExpectancyInput'),
			d.lifeExpectancyInput
		),
		desiredIncomeInput: coerceString(readField(record, 'desiredIncomeInput'), d.desiredIncomeInput),
		desiredIncomeTouched: coerceBoolean(
			readField(record, 'desiredIncomeTouched'),
			d.desiredIncomeTouched
		),
		desiredIncomeLocale: coerceString(
			readField(record, 'desiredIncomeLocale'),
			d.desiredIncomeLocale
		),
		adoptedMonthlyCents: coerceAdoptedCents(readField(record, 'adoptedMonthlyCents')),
		incomeBasis: coerceMember(readField(record, 'incomeBasis'), VALID_INCOME_BASES, d.incomeBasis),
		annualReturnInput: coerceString(readField(record, 'annualReturnInput'), d.annualReturnInput),
		// Untouched means mirroring, so a stored rate would be invisible state; collapse it on the way in.
		postRetirementReturnInput: postRetirementTouched
			? coerceString(readField(record, 'postRetirementReturnInput'), d.postRetirementReturnInput)
			: '',
		postRetirementTouched,
		model: coerceMember(readField(record, 'model'), VALID_MODELS, d.model),
	}
}
