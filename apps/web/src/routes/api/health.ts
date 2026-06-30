/**
 * Health (liveness) Route
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Endpoint: GET /api/health
 *
 * Liveness probe — answers "is the process up?". Intentionally has NO database
 * dependency so it stays fast and safe under Rapids scale-to-zero / SSR boot
 * (NFR8), and so uptime monitors can probe it cheaply (story 5-5 AC-1).
 * Returns a minimal payload only — no versions, stack, or secrets.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const GET = async (): Promise<Response> => {
  return json({ status: 'ok' }, { status: 200 })
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET,
    },
  },
})
