/**
 * Logout
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Invalidates user session
 *
 * Endpoint: POST /api/auth/logout
 */

import { logoutUser } from '@/server/api/auth/paddle'
import { buildClearSessionCookies, isProductionEnv } from '@/server/api/auth/session-cookies'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const result = await logoutUser(request)

  // Clear the session cookies UNCONDITIONALLY. This is a client-side action
  // that cannot fail and must not be coupled to the server-side revocation DB
  // write — otherwise a transient DB error would leave the user logged in on
  // BOTH sides. Server-side revocation (sessionsRevokedAt) is the durable
  // control; clearing the cookies is defense-in-depth on top. Also clears the
  // non-HttpOnly `has_session` companion marker (Story 53.1) — leaving it
  // behind after logout would tell SyncProvider "probably signed in" is true
  // for a signed-out browser.
  const [clearCookie, clearHasSessionCookie] = buildClearSessionCookies(isProductionEnv())

  const response = result.success
    ? json({ success: true })
    : json({ success: false, error: result.error }, { status: 500 })
  response.headers.append('Set-Cookie', clearCookie)
  response.headers.append('Set-Cookie', clearHasSessionCookie)

  return response
}

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST,
    },
  },
})
