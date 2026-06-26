/**
 * Compounding Projection Calculation Route
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Serves the compounding-projection calculation for paid-tier users.
 *
 * Endpoint: POST /api/calculations/projection
 *
 * Calculation logic and auth/premium enforcement live in
 * `@/server/functions/financial` (compoundingProjection).
 */

import { compoundingProjection, httpStatusForResult } from '@/server/functions/financial'
import type { CompoundingInput } from '@budget-planner/core'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  let input: CompoundingInput
  try {
    input = (await request.json()) as CompoundingInput
  } catch {
    return json({ success: false, error: 'Invalid JSON request body' }, { status: 400 })
  }

  const result = await compoundingProjection(request, input)
  return json(result, { status: httpStatusForResult(result) })
}

export const Route = createFileRoute('/api/calculations/projection')({
  server: {
    handlers: {
      POST,
    },
  },
})
