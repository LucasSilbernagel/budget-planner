import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	DURATION_LABEL,
	DURATION_OPTION_LABEL,
	OVERVIEW_DURATION_STORAGE_KEY,
	useOverviewDurationStore,
	VALID_DURATIONS,
} from '../overviewDurationStore'

beforeEach(() => {
	localStorage.clear()
	useOverviewDurationStore.setState({ duration: 'annually' })
})

describe('overviewDurationStore', () => {
	it('defaults to annually (deterministic, SSR-safe)', async () => {
		// A fresh module, not the singleton: beforeEach sets 'annually' on it, so asserting there passes
		// whatever the default is. The key is removed because that setState also writes it.
		localStorage.removeItem(OVERVIEW_DURATION_STORAGE_KEY)
		expect(localStorage.getItem(OVERVIEW_DURATION_STORAGE_KEY)).toBeNull()
		vi.resetModules()
		const fresh = await import('../overviewDurationStore')
		expect(fresh.useOverviewDurationStore.getState().duration).toBe('annually')
		await fresh.useOverviewDurationStore.persist.rehydrate()
		expect(fresh.useOverviewDurationStore.getState().duration).toBe('annually')
	})

	it('setDuration sets the duration', () => {
		useOverviewDurationStore.getState().setDuration('weekly')
		expect(useOverviewDurationStore.getState().duration).toBe('weekly')

		useOverviewDurationStore.getState().setDuration('monthly')
		expect(useOverviewDurationStore.getState().duration).toBe('monthly')
	})

	it('persists only the duration under the versioned key', () => {
		useOverviewDurationStore.getState().setDuration('weekly')

		const raw = localStorage.getItem(OVERVIEW_DURATION_STORAGE_KEY)
		expect(raw).not.toBeNull()

		const parsed = JSON.parse(raw as string)
		expect(parsed.state.duration).toBe('weekly')
		expect(Object.keys(parsed.state)).toEqual(['duration'])
	})

	it('rehydrates a valid persisted duration', async () => {
		localStorage.setItem(
			OVERVIEW_DURATION_STORAGE_KEY,
			JSON.stringify({ state: { duration: 'weekly' }, version: 0 })
		)
		await useOverviewDurationStore.persist.rehydrate()
		expect(useOverviewDurationStore.getState().duration).toBe('weekly')
	})

	it('coerces a corrupt/unknown persisted duration back to the default on rehydrate', async () => {
		localStorage.setItem(
			OVERVIEW_DURATION_STORAGE_KEY,
			JSON.stringify({ state: { duration: 'daily' }, version: 0 })
		)
		await useOverviewDurationStore.persist.rehydrate()
		expect(useOverviewDurationStore.getState().duration).toBe('annually')
	})
})

describe('overviewDurationStore — biweekly as the fourth duration (story 32.1, FR58)', () => {
	it('setDuration accepts biweekly', () => {
		useOverviewDurationStore.getState().setDuration('biweekly')
		expect(useOverviewDurationStore.getState().duration).toBe('biweekly')
	})

	/** Catches a union widened without the valid set: coercion would silently reset biweekly on reload. */
	it('rehydrates a persisted biweekly rather than coercing it to the default', async () => {
		localStorage.setItem(
			OVERVIEW_DURATION_STORAGE_KEY,
			JSON.stringify({ state: { duration: 'biweekly' }, version: 0 })
		)
		await useOverviewDurationStore.persist.rehydrate()
		expect(useOverviewDurationStore.getState().duration).toBe('biweekly')
	})

	it('exposes exactly the four entry frequencies, in ascending-period order', () => {
		expect(VALID_DURATIONS).toEqual(['weekly', 'biweekly', 'monthly', 'annually'])
	})

	/** Does not compare DURATION_LABEL's keys to VALID_DURATIONS: one derives from the other. */
	it('keeps the option-label map in step with the valid set', () => {
		expect(Object.keys(DURATION_OPTION_LABEL)).toEqual([...VALID_DURATIONS])
	})

	it('labels biweekly with the shipped "(per …)" suffix convention', () => {
		expect(DURATION_LABEL).toEqual({
			weekly: '(per week)',
			biweekly: '(per 2 weeks)',
			monthly: '(per month)',
			annually: '(per year)',
		})
	})

	it('labels the biweekly option to match the frequency selects on the entry pages', () => {
		expect(DURATION_OPTION_LABEL.biweekly).toBe('Bi-weekly')
	})
})
