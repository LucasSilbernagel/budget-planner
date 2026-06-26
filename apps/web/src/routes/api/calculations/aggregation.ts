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
  type AggregationInput,
  complexAggregation,
  httpStatusForResult,
} from '@/server/functions/financial'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  let input: AggregationInput
  try {
    input = (await request.json()) as AggregationInput
  } catch {
    return json({ success: false, error: 'Invalid JSON request body' }, { status: 400 })
  }

  const result = await complexAggregation(request, input)
  return json(result, { status: httpStatusForResult(result) })
}

export const Route = createFileRoute('/api/calculations/aggregation')({
  server: {
    handlers: {
      POST,
    },
  },
})
