/**
 * Global Vitest setup for @budget-planner/web.
 *
 * - Registers @testing-library/jest-dom custom matchers (toBeInTheDocument, …)
 * - Starts the MSW server so all external calls (Paddle, counter.dev) are mocked
 * - Cleans up the React Testing Library DOM after each test (jsdom only)
 *
 * This file runs for every test regardless of environment, so the RTL cleanup
 * is guarded for `node`-environment tests where `document` is undefined.
 */

import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest'
import { server } from './src/mocks/server'
import { useCurrencyStore } from './src/stores/currencyStore'

// Register jest-dom matchers explicitly rather than via the
// `@testing-library/jest-dom/vitest` side-effect import. Vitest externalizes
// node_modules for its SSR transform, so jest-dom's internal `import { expect }
// from 'vitest'` resolves a different `expect` instance than the one injected
// into each test's scope — its `expect.extend` would then land on the wrong
// instance and matchers like `toBeInTheDocument` would be missing. Importing the
// matchers here (a transformed local file) and extending the setup file's own
// `expect` binding wires them to the correct instance.
expect.extend(jestDomMatchers)

// jsdom does not implement ResizeObserver, which Recharts' <ResponsiveContainer>
// instantiates on mount. Provide a no-op stub so component tests that render charts
// (e.g. SavingsChart, RetirementTimelineChart) don't throw. Only defined when
// missing, so a real implementation (if ever present) is never clobbered.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

// Fail loudly if a test triggers a request we have not mocked.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Pin the currency store to the currency-less baseline before every jsdom test
// (story 22-1). The product default is now explicit `$`/USD, but component tests
// that render amounts via the store default assert neutral grouped numbers
// ('4,000.00'); this keeps that baseline stable so the default flip does not
// churn dozens of unrelated assertions. Tests needing symbols set the store
// explicitly; the store's own test asserts the real default via getInitialState().
//
// ⚠️ Gated to jsdom (`document` present): `setState` DOES go through zustand's
// persist write path (`skipHydration` only skips the initial READ, not writes).
// In the node test environment `localStorage` is unavailable, so an unguarded
// write throws (`undefined.setItem`) and fails every node-env test. Node-env
// tests never render currency, so the reset is only needed under jsdom.
beforeEach(() => {
  if (typeof document !== 'undefined') {
    useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
  }
})

afterEach(() => {
  server.resetHandlers()
  if (typeof document !== 'undefined') {
    cleanup()
  }
})

afterAll(() => server.close())
