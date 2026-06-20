/**
 * Logout
 * 
 * TanStack Start Server Function
 * Invalidates user session
 * 
 * Endpoint: POST /api/auth/logout
 */

import { logoutUser } from '@/server/api/auth/paddle'
import { json } from '@tanstack/start'

export async function POST() {
  const result = await logoutUser()
  
  if (!result.success) {
    return json(
      { success: false, error: result.error },
      { status: 500 }
    )
  }
  
  // Clear session cookie
  const response = json({ success: true })
  response.headers.set(
    'Set-Cookie',
    'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  )
  
  return response
}
