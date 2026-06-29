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

import {
  compoundingInputSchema,
  compoundingProjection,
  httpStatusForResult,
  parseCalcInput,
} from '@/server/functions/financial'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ success: false, error: 'Invalid JSON request body' }, { status: 400 })
  }

  const parsed = parseCalcInput(compoundingInputSchema, raw)
  if (!parsed.success) {
    return json(parsed, { status: httpStatusForResult(parsed) })
  }

  const result = await compoundingProjection(request, parsed.data)
  return json(result, { status: httpStatusForResult(result) })
}

export const Route = createFileRoute('/api/calculations/projection')({
  server: {
    handlers: {
      POST,
    },
  },
})
