/**
 * Logout
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Invalidates user session
 *
 * Endpoint: POST /api/auth/logout
 */

import { logoutUser } from '@/server/api/auth/paddle'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async () => {
        const result = await logoutUser()

        if (!result.success) {
          return json({ success: false, error: result.error }, { status: 500 })
        }

        // Clear session cookie
        const response = json({ success: true })
        response.headers.set('Set-Cookie', 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')

        return response
      },
    },
  },
})
