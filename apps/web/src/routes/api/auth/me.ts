/**
 * Get Current User
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Returns current authenticated user session
 *
 * Endpoint: GET /api/auth/me
 */

import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

/**
 * GET /api/auth/me — exported standalone so it is unit-testable without a
 * running server (Story 70.1), as `logout.ts` does; the Route below wires it in.
 */
export const GET = async ({ request }: { request: Request }): Promise<Response> => {
  const result = await getCurrentUserSession(request)

  if (!result.success) {
    // 503, not 401. Since Story 5-19 `{success:false}` means the session
    // could not be RESOLVED (a DB/infra failure), not that the caller is
    // unauthenticated — an unauthenticated request is `{success:true,
    // data:null}` and returns `{user:null}` below. Reporting 401 here
    // would tell a signed-in client it had been signed out by an outage,
    // which is the wrong state to assert and the wrong one to act on.
    return json({ success: false, error: result.error }, { status: 503 })
  }

  // Return null if not authenticated
  if (!result.data) {
    return json({ user: null })
  }

  // Return user session (sanitize if needed)
  return json({
    user: {
      userId: result.data.userId,
      email: result.data.email,
      paddleId: result.data.paddleId,
      subscriptionStatus: result.data.subscriptionStatus,
      // Story 70.1: the Settings plan label ("Annual Plan") reads this.
      billingInterval: result.data.billingInterval,
      currency: result.data.currency,
      isAuthenticated: result.data.isAuthenticated,
    },
  })
}

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET,
    },
  },
})
