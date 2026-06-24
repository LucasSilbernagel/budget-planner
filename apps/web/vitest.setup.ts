/**
 * Global Vitest setup for @budget-planner/web.
 *
 * - Registers @testing-library/jest-dom custom matchers (toBeInTheDocument, …)
 * - Starts the MSW server so all external calls (Paddle, EthicalAds) are mocked
 * - Cleans up the React Testing Library DOM after each test (jsdom only)
 *
 * This file runs for every test regardless of environment, so the RTL cleanup
 * is guarded for `node`-environment tests where `document` is undefined.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './src/mocks/server'

// Fail loudly if a test triggers a request we have not mocked.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  server.resetHandlers()
  if (typeof document !== 'undefined') {
    cleanup()
  }
})

afterAll(() => server.close())
