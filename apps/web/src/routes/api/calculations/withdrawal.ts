/**
 * Safe Withdrawal Calculation Route
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Serves the safe-monthly-withdrawal calculation for paid-tier users.
 *
 * Endpoint: POST /api/calculations/withdrawal
 * Body: { assets: number, annualReturnRate: number }
 *
 * Calculation logic and auth/premium enforcement live in
 * `@/server/functions/financial` (safeWithdrawalCalculation).
 */

import {
  httpStatusForResult,
  parseCalcInput,
  safeWithdrawalCalculation,
  withdrawalBodySchema,
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

  const parsed = parseCalcInput(withdrawalBodySchema, raw)
  if (!parsed.success) {
    return json(parsed, { status: httpStatusForResult(parsed) })
  }

  const result = await safeWithdrawalCalculation(
    request,
    parsed.data.assets,
    parsed.data.annualReturnRate
  )
  return json(result, { status: httpStatusForResult(result) })
}

export const Route = createFileRoute('/api/calculations/withdrawal')({
  server: {
    handlers: {
      POST,
    },
  },
})
