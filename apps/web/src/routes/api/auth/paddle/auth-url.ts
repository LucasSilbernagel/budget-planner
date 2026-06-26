/**
 * Paddle Authentication - Generate Auth URL
 *
 * TanStack Start server route (file-route `server.handlers`)
 * Generates Paddle OAuth URL for user authentication
 *
 * Endpoint: POST /api/auth/paddle/auth-url
 *
 * Note: POST per AC-4. The legacy handler was authored as GET, but there is no
 * client caller (the Paddle client opens checkout directly), so the endpoint is
 * registered POST-only to match the acceptance criterion exactly and avoid
 * exposing an auth-URL generator over a trivially-triggerable GET.
 *
 * Data Sovereignty: Redirects to Paddle (UK-based) for authentication
 */

import { generatePaddleAuthUrl } from '@/server/api/auth/paddle'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/auth/paddle/auth-url')({
  server: {
    handlers: {
      POST: async () => {
        const result = await generatePaddleAuthUrl()

        if (!result.success) {
          return json({ success: false, error: result.error }, { status: 400 })
        }

        return json(result.data)
      },
    },
  },
})
