/**
 * Paddle Authentication - Callback Handler
 * 
 * TanStack Start Server Function
 * Handles Paddle OAuth callback after user authentication
 * 
 * Endpoint: GET /api/auth/paddle/callback
 * 
 * Flow:
 * 1. User authenticates with Paddle
 * 2. Paddle redirects to this endpoint with authorization code
 * 3. We exchange code for access token
 * 4. We fetch user information from Paddle
 * 5. We create/update user in Scaleway PostgreSQL
 * 6. We create session and set cookies
 * 7. We redirect user to appropriate page
 * 
 * Data Sovereignty: User data stored in Scaleway EU region (NFR1, NFR2)
 */

import { handlePaddleCallback } from '@/server/api/auth/paddle'
import { json, redirect } from '@tanstack/start'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  
  if (!code) {
    return json(
      { success: false, error: 'Authorization code is required' },
      { status: 400 }
    )
  }
  
  const result = await handlePaddleCallback(code, state || '')
  
  if (!result.success) {
    return json(
      { success: false, error: result.error },
      { status: 400 }
    )
  }
  
  // Create session cookie
  // In production, use httpOnly, secure cookies
  const response = new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `session=${JSON.stringify(result.data)}; Path=/; HttpOnly; SameSite=Lax`,
    },
  })
  
  return response
}
