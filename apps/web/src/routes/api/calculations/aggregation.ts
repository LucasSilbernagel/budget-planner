/**
 * Complex Aggregation Calculation Route
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Serves the complex-aggregation calculation for paid-tier users.
 *
 * Endpoint: POST /api/calculations/aggregation
 *
 * Calculation logic and auth/premium enforcement live in
 * `@/server/functions/financial` (complexAggregation).
 */

import {
  aggregationInputSchema,
  complexAggregation,
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

  const parsed = parseCalcInput(aggregationInputSchema, raw)
  if (!parsed.success) {
    return json(parsed, { status: httpStatusForResult(parsed) })
  }

  const result = await complexAggregation(request, parsed.data)
  return json(result, { status: httpStatusForResult(result) })
}

export const Route = createFileRoute('/api/calculations/aggregation')({
  server: {
    handlers: {
      POST,
    },
  },
})
