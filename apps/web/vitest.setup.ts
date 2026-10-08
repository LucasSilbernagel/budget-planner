// ⚠️ FIRST: it sets up Web Storage before the store imports below read it. The
// blank line after it is a separate import group, so Biome does not sort it last.
import './src/test/webstorage'

import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest'
import { server } from './src/mocks/server'
import { useCurrencyStore } from './src/stores/currencyStore'
import { useRetirementPlannerStore } from './src/stores/retirementPlannerStore'
import { useTableSortStore } from './src/stores/tableSortStore'

// Extend this file's own `expect`: the `jest-dom/vitest` side-effect import extends a different
// instance because Vitest externalizes node_modules.
expect.extend(jestDomMatchers)

// jsdom lacks ResizeObserver, which Recharts' ResponsiveContainer needs on mount.
if (typeof globalThis.ResizeObserver === 'undefined') {
	globalThis.ResizeObserver = class ResizeObserver {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	}
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Gated to jsdom: `setState` writes through persist even under `skipHydration`, and node env
// has no localStorage. Stores are module singletons, so reset them per test.
beforeEach(() => {
	if (typeof document !== 'undefined') {
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
		useTableSortStore.setState({
			sorts: { income: null, expenses: null, savings: null, balance: null },
		})
		// Remove the entry setState just wrote, or tests enumerating localStorage see a phantom blob.
		localStorage.removeItem('budget-planner-table-sort-v1')
		useRetirementPlannerStore.getState().resetPlan()
		localStorage.removeItem('budget-planner-retirement-planner-v1')
		// A dismissal is a permanent raw flag, so one Dismiss click would hide the box in later tests.
		localStorage.removeItem('bp-overview-account-notice-dismissed')
	}
})

afterEach(() => {
	server.resetHandlers()
	if (typeof document !== 'undefined') {
		cleanup()
	}
})

afterAll(() => server.close())
