/**
 * Account deletion (Story 10-5)
 *
 * TanStack Start server route (file-route `server.handlers`).
 * Hard-deletes the authenticated user and ALL data they own (GDPR Art. 17 /
 * PIPEDA erasure), then signs them out. This is "logout + erase".
 *
 * Endpoint: POST /api/account/delete
 *
 * - Auth + ownership are enforced SERVER-SIDE: `deleteUserAccount` takes the
 *   target user id from the HMAC-signed, DB-authoritative session cookie
 *   (Story 5-7), never from the client body. No session → 401.
 * - Deliberately NOT gated on active-premium status. Right to erasure is not
 *   conditional on a live subscription — a `canceled`/`past_due` user still has
 *   synced rows and the legal right to delete them. Gate is "authenticated"
 *   only. (Contrast sync/batch.ts, which gates on PAID_SYNC_STATUSES — that gate
 *   would be WRONG here. Do not "fix" it to match.)
 */

import { deleteUserAccount } from '@/server/api/account'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production'
}

/**
 * Clear the session cookie. Matches how the session is set (login/verify,
 * paddle/callback): `Secure` is added in production only.
 */
function clearSessionCookie(): string {
  const secureFlag = isProduction() ? '; Secure' : ''
  return `session=; Path=/; HttpOnly; SameSite=Lax${secureFlag}; Max-Age=0`
}

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const result = await deleteUserAccount(request)

  if (result.success) {
    // Erasure succeeded — clear the cookie and report success. The DB row is
    // gone so the session is already unauthenticatable; the cookie clear is the
    // client-side half of signing out.
    const response = json({ success: true })
    response.headers.set('Set-Cookie', clearSessionCookie())
    return response
  }

  if (result.reason === 'unauthenticated') {
    return json({ success: false, error: 'Not authenticated' }, { status: 401 })
  }

  // Unexpected server/DB error. Do not leak internal detail.
  return json({ success: false, error: 'Failed to delete account' }, { status: 500 })
}

export const Route = createFileRoute('/api/account/delete')({
  server: {
    handlers: {
      POST,
    },
  },
})
