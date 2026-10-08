/// <reference path="./jest-dom.d.ts" />

import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router'
import { type RenderOptions, type RenderResult, render } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'

export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'

export function renderWithProviders(
	ui: ReactElement,
	options?: Omit<RenderOptions, 'wrapper'>
): RenderResult {
	return render(ui, { ...options })
}

export function renderWithRouter(
	ui: ReactElement,
	{ path = '/' }: { path?: string } = {}
): RenderResult {
	const rootRoute = createRootRoute({ component: () => ui })
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: [path] }),
	})
	return render(createElement(RouterProvider, { router }))
}

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
