/**
 * Deliberately not gated on paid access: erasure applies to canceled and past_due users
 * too, so the gate is "authenticated" only.
 */

import { deleteUserAccount } from '@/server/api/account'
import { buildClearSessionCookies, isProductionEnv } from '@/server/api/auth/session-cookies'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const POST = async ({ request }: { request: Request }): Promise<Response> => {
  const result = await deleteUserAccount(request)

  if (result.success) {
    const response = json({ success: true })
    for (const cookie of buildClearSessionCookies(isProductionEnv())) {
      response.headers.append('Set-Cookie', cookie)
    }
    return response
  }

  if (result.reason === 'unauthenticated') {
    return json({ success: false, error: 'Not authenticated' }, { status: 401 })
  }

  return json({ success: false, error: 'Failed to delete account' }, { status: 500 })
}

export const Route = createFileRoute('/api/account/delete')({
  server: {
    handlers: {
      POST,
    },
  },
})
