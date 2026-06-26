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

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const result = await getCurrentUserSession(request)

        if (!result.success) {
          return json({ success: false, error: result.error }, { status: 401 })
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
            currency: result.data.currency,
            isAuthenticated: result.data.isAuthenticated,
          },
        })
      },
    },
  },
})
