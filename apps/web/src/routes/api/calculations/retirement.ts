/**
 * Retirement Calculation Route
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Serves the retirement-requirement calculation for paid-tier users.
 *
 * Endpoint: POST /api/calculations/retirement
 *
 * The calculation logic and auth/premium enforcement live in
 * `@/server/functions/financial` (retirementCalculation); this route is the
 * thin HTTP boundary that parses the JSON body and maps the result to a status.
 */

import { httpStatusForResult, retirementCalculation } from '@/server/functions/financial'
import type { RetirementInput } from '@budget-planner/core'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  let input: RetirementInput
  try {
    input = (await request.json()) as RetirementInput
  } catch {
    return json({ success: false, error: 'Invalid JSON request body' }, { status: 400 })
  }

  const result = await retirementCalculation(request, input)
  return json(result, { status: httpStatusForResult(result) })
}

export const Route = createFileRoute('/api/calculations/retirement')({
  server: {
    handlers: {
      POST,
    },
  },
})
