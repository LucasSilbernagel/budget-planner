// A resolver error returns null (unverified), not the signed-out seed, so clients re-check
// instead of showing a paid user the free tier.

import { createServerFn } from '@tanstack/react-start'
import { SIGNED_OUT_SEED, type SessionSeed } from '../../../context/session-seed'

export const getSessionSeed = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionSeed | null> => {
    // Dev-only test seam: import.meta.env.DEV is a build-time literal, so production drops it.
    // This grants a seed only: never a signed cookie or DB user. It is not a way to sign in.
    if (import.meta.env.DEV && process.env['E2E_SESSION_SEED']) {
      // The try/catch sits inside the gate so production elimination drops every string naming the variable.
      // A malformed value logs and falls through to null.
      try {
        const parsed: unknown = JSON.parse(process.env['E2E_SESSION_SEED'])
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as SessionSeed).isAuthenticated === 'boolean'
        ) {
          return parsed as SessionSeed
        }
        console.error('Dev session override is not a valid seed object; ignoring it')
      } catch (error) {
        console.error('Dev session override is not valid JSON; ignoring it:', error)
      }
      return null
    }

    try {
      // Dynamically imported inside the extracted server handler so neither the
      // framework server entry nor the session resolver leaks into the client.
      const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
      const { getCurrentUserSession } = await import('./paddle')

      const { lookupSessionOnce } = await import('./session-lookup-once')

      const result = await lookupSessionOnce(getRequest(), getCurrentUserSession)

      if (!result.success) {
        console.error('getSessionSeed: session resolution failed:', result.error)
        return null
      }

      if (result.data) {
        const session = result.data
        // The document now carries the user's email and tier: never let a shared cache serve it.
        setResponseHeader('cache-control', 'private, no-store')
        return {
          isAuthenticated: true,
          userId: session.userId,
          email: session.email,
          subscriptionStatus: session.subscriptionStatus,
        }
      }

      return { ...SIGNED_OUT_SEED }
    } catch (error) {
      console.error('getSessionSeed: unexpected error resolving session:', error)
      return null
    }
  }
)
