import { createRoute, createRootRoute, createRouter } from '@tanstack/react-router'
import { HomePage } from './components/HomePage'
import { IncomePage } from './components/IncomePage'
import { ExpensesPage } from './components/ExpensesPage'

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

// Add children to root and export route tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  incomeRoute,
  expensesRoute,
])

// Also export the router instance for convenience
export const router = createRouter({ routeTree })
