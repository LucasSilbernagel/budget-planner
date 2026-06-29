/**
 * TanStack Start global configuration (Story 5.8 — AC-14)
 *
 * Registers a global request middleware that applies the baseline security
 * response headers to EVERY server response (SSR pages, server routes, and
 * server functions). This is the real, executed replacement for the headers
 * that were stranded in the removed `tanstack.config.ts`.
 */

import { createMiddleware, createStart } from '@tanstack/react-start'
import { applyHeadersToNextResult } from './server/middleware/security-headers'

const securityHeadersMiddleware = createMiddleware({ type: 'request' }).server(({ next }) =>
  applyHeadersToNextResult(next, process.env['NODE_ENV'] === 'development')
)

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
}))
