import { createRoute, createRootRoute, createRouter } from '@tanstack/react-router'
import { HomePage } from './components/HomePage'
import { IncomePage } from './components/IncomePage'
import { ExpensesPage } from './components/ExpensesPage'
import { SavingsPage } from './components/SavingsPage'
import { BalancePage } from './components/BalancePage'
import { NetWorthProjectionPage } from './components/NetWorthProjectionPage'

// Root route (no component, just for organization)
export const rootRoute = createRootRoute()

// Index route
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

// Income route
export const incomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'income',
  component: IncomePage,
})

// Expenses route
export const expensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'expenses',
  component: ExpensesPage,
})

// Savings route
export const savingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'savings',
  component: SavingsPage,
})

// Balance route
export const balanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'balance',
  component: BalancePage,
})

// Net worth projection route
export const netWorthProjectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'net-worth-projection',
  component: NetWorthProjectionPage,
})

// Add children to root and export route tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  incomeRoute,
  expensesRoute,
  savingsRoute,
  balanceRoute,
  netWorthProjectionRoute,
])

// Also export the router instance for convenience
export const router = createRouter({ routeTree })
