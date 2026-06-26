/**
 * Net Worth Projection Calculation Route
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Serves the net-worth-projection calculation for paid-tier users.
 *
 * Endpoint: POST /api/calculations/net-worth
 *
 * Calculation logic and auth/premium enforcement live in
 * `@/server/functions/financial` (netWorthProjection).
 */

import {
  type NetWorthProjectionInput,
  httpStatusForResult,
  netWorthProjection,
} from '@/server/functions/financial'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  let input: NetWorthProjectionInput
  try {
    input = (await request.json()) as NetWorthProjectionInput
  } catch {
    return json({ success: false, error: 'Invalid JSON request body' }, { status: 400 })
  }

  const result = await netWorthProjection(request, input)
  return json(result, { status: httpStatusForResult(result) })
}

export const Route = createFileRoute('/api/calculations/net-worth')({
  server: {
    handlers: {
      POST,
    },
  },
})
