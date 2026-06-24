/**
 * Paddle Authentication - Generate Auth URL
 *
 * TanStack Start Server Function
 * Generates Paddle OAuth URL for user authentication
 *
 * Endpoint: GET /api/auth/paddle/auth-url
 *
 * Data Sovereignty: Redirects to Paddle (UK-based) for authentication
 */

import { generatePaddleAuthUrl } from '@/server/api/auth/paddle'
import { json } from '@tanstack/start'

export async function GET() {
  const result = await generatePaddleAuthUrl()

  if (!result.success) {
    return json({ success: false, error: result.error }, { status: 400 })
  }

  return json(result.data)
}
