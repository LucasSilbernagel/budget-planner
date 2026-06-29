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

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const result = await logoutUser(request)

  // Clear the session cookie UNCONDITIONALLY. This is a client-side action that
  // cannot fail and must not be coupled to the server-side revocation DB write —
  // otherwise a transient DB error would leave the user logged in on BOTH sides.
  // Server-side revocation (sessionsRevokedAt) is the durable control; clearing
  // the cookie is defense-in-depth on top.
  const clearCookie = 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'

  const response = result.success
    ? json({ success: true })
    : json({ success: false, error: result.error }, { status: 500 })
  response.headers.set('Set-Cookie', clearCookie)

  return response
}

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST,
    },
  },
})
