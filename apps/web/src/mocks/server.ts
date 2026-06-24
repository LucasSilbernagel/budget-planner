/**
 * MSW server for the Node/Vitest test environment.
 *
 * `setupServer` intercepts requests made from both the `node` and `jsdom`
 * Vitest environments. Lifecycle wiring (listen/resetHandlers/close) lives in
 * `vitest.setup.ts` so every test file shares one server instance.
 */

import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
