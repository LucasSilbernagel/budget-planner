/**
 * Shared test utilities.
 *
 * - `renderWithProviders` is the canonical way to render components under test.
 *   It is intentionally thin today; wrap app-wide providers (Zustand stores,
 *   the TanStack Router, etc.) here as they are introduced so every test picks
 *   them up automatically.
 * - Test data factories build valid domain objects with sensible defaults and
 *   shallow overrides, so tests only specify the fields they care about.
 *
 * Re-exports everything from @testing-library/react so tests import a single
 * module: `import { renderWithProviders, screen, makeIncomeSource } from '@/test/utils'`.
 */

import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { type RenderOptions, render } from '@testing-library/react'
import { type ReactElement, createElement } from 'react'

export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'

/**
 * Render a component with all app-wide providers applied.
 * Extend the wrapper as global providers are added to the app.
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { ...options })
}

/**
 * Render a component inside a minimal TanStack Router context.
 *
 * Components that read the current location (e.g. via `useLocation`) need a
 * router in scope. This builds a throwaway in-memory router whose root route
 * renders `ui`, with `path` seeding the initial location so tests can assert
 * location-derived output (story 4-9 FeedbackLink, etc.).
 */
export function renderWithRouter(ui: ReactElement, { path = '/' }: { path?: string } = {}) {
  const rootRoute = createRootRoute({ component: () => ui })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(createElement(RouterProvider, { router }))
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'annually'

export interface IncomeSourceLike {
  id: string
  userId: string
  name: string
  amount: number
  frequency: Frequency
}

export interface ExpenseLike {
  id: string
  userId: string
  name: string
  amount: number
  frequency: Frequency
}

export interface SavingsGoalLike {
  id: string
  userId: string
  name: string
  targetAmount: number
  currentBalance: number
}

let idCounter = 0
/** Deterministic, collision-free id for test fixtures. */
export function testId(prefix = 'test'): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

export function makeIncomeSource(overrides: Partial<IncomeSourceLike> = {}): IncomeSourceLike {
  return {
    id: testId('income'),
    userId: testId('user'),
    name: 'Salary',
    amount: 5000,
    frequency: 'monthly',
    ...overrides,
  }
}

export function makeExpense(overrides: Partial<ExpenseLike> = {}): ExpenseLike {
  return {
    id: testId('expense'),
    userId: testId('user'),
    name: 'Rent',
    amount: 1500,
    frequency: 'monthly',
    ...overrides,
  }
}

export function makeSavingsGoal(overrides: Partial<SavingsGoalLike> = {}): SavingsGoalLike {
  return {
    id: testId('goal'),
    userId: testId('user'),
    name: 'Emergency Fund',
    targetAmount: 10000,
    currentBalance: 2500,
    ...overrides,
  }
}
