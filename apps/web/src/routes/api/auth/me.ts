import { getCurrentUserSession } from '@/server/api/auth/paddle'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const GET = async ({ request }: { request: Request }): Promise<Response> => {
  const result = await getCurrentUserSession(request)

  if (!result.success) {
    // 503, not 401: `{success:false}` means the session could not be resolved. A 401 would
    // tell a signed-in client it was signed out by an outage.
    return json({ success: false, error: result.error }, { status: 503 })
  }

  if (!result.data) {
    return json({ user: null })
  }

  return json({
    user: {
      userId: result.data.userId,
      email: result.data.email,
      paddleId: result.data.paddleId,
      subscriptionStatus: result.data.subscriptionStatus,
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
