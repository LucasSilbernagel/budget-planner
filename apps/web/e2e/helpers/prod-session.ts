import crypto from 'node:crypto'
import type { BrowserContext } from '@playwright/test'

/**
 * A validly SIGNED session cookie for the `chromium-prod` server (story 83.1).
 *
 * ## Why a real signature, on a server with no database
 *
 * The production server in `playwright.config.ts` runs with `DATABASE_URL` empty.
 * With this cookie, `validateSessionToken` accepts the signature, then its user
 * lookup throws (no database), `getCurrentUserSession` answers `success: false`,
 * and `getSessionSeed` returns `null`. That is the NO-SEED path, where
 * `usePremiumAccess` asks `/api/auth/me` from the browser (stubbed by the spec).
 * MEASURED at `31e74bf` (story 83.1, M3/M4).
 *
 * ⚠️ With NO cookie, or a cookie whose signature fails, the seed is a signed-OUT
 * seed and the page shows the upgrade prompt without asking anything. So if this
 * format drifts from `src/server/api/auth/session.ts` (`<base64url(JSON)>.<hex
 * HMAC-SHA256 over the base64url>`), the spec fails loudly on the prompt; it can
 * never pass silently. Not imported from `src/`: `tsconfig.e2e.json` lists every
 * `src/` file a spec may import by name, and `session.ts` pulls in the server.
 *
 * ⚠️ `userId` must be a UUID: `validateSessionToken` rejects anything else BEFORE
 * the database, which gives the signed-out seed.
 *
 * ⚠️ Only `session` is set, NOT `has_session`. Without `has_session`,
 * `SyncProvider` skips its probe (`hasProbableSession`), so the sync engine never
 * mounts and the spec need not stub `/api/sync/*`.
 */

/** Shared with `playwright.config.ts`, which boots the server with it. */
export const PROD_E2E_SESSION_SECRET = 'e2e-prod-only-session-secret-0123456789abcdef0123456789'

export const PROD_E2E_USER_ID = '11111111-1111-4111-8111-111111111111'

export function signProdSession(userId: string = PROD_E2E_USER_ID): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, paddleId: 'ctm_e2e', email: 'e2e-prod@example.test', iat: Date.now() })
  ).toString('base64url')
  const signature = crypto
    .createHmac('sha256', PROD_E2E_SESSION_SECRET)
    .update(payload)
    .digest('hex')
  return `${payload}.${signature}`
}

export async function addProdSessionCookie(
  context: BrowserContext,
  baseURL: string
): Promise<void> {
  await context.addCookies([
    { name: 'session', value: signProdSession(), url: baseURL, httpOnly: true, sameSite: 'Lax' },
  ])
}
