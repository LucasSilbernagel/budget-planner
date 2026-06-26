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

import { httpStatusForResult, safeWithdrawalCalculation } from '@/server/functions/financial'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

interface WithdrawalBody {
  assets: number
  annualReturnRate: number
}

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  let body: WithdrawalBody
  try {
    body = (await request.json()) as WithdrawalBody
  } catch {
    return json({ success: false, error: 'Invalid JSON request body' }, { status: 400 })
  }

  const result = await safeWithdrawalCalculation(request, body.assets, body.annualReturnRate)
  return json(result, { status: httpStatusForResult(result) })
}

export const Route = createFileRoute('/api/calculations/withdrawal')({
  server: {
    handlers: {
      POST,
    },
  },
})
