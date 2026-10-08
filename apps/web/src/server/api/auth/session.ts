// Signed, not encrypted: the payload holds identity only; subscription status is read from the DB.

import crypto from 'node:crypto'
import { getSessionSecret } from '@budget-planner/config'

// `iat` is HMAC-protected, so a client cannot back-date it past a revocation watermark.
export interface SessionPayload {
  userId: string
  paddleId: string
  email: string
  iat: number
}

function computeSignature(encodedPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('hex')
}

export function signSession(payload: Omit<SessionPayload, 'iat'>): string {
  const secret = getSessionSecret()
  const fullPayload: SessionPayload = { ...payload, iat: Date.now() }
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  const signature = computeSignature(encodedPayload, secret)
  return `${encodedPayload}.${signature}`
}

export function verifySession(token: string | null | undefined): SessionPayload | null {
  if (!token) {
    return null
  }

  try {
    const separatorIndex = token.indexOf('.')
    if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
      return null
    }

    const encodedPayload = token.slice(0, separatorIndex)
    const providedSignature = token.slice(separatorIndex + 1)

    const secret = getSessionSecret()
    const expectedSignature = computeSignature(encodedPayload, secret)

    const providedBuffer = Buffer.from(providedSignature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    // timingSafeEqual throws on length mismatch.
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return null
    }

    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8')
    const payload = JSON.parse(decoded) as Partial<SessionPayload>

    if (!payload.userId || !payload.paddleId || !payload.email) {
      return null
    }

    return {
      userId: payload.userId,
      paddleId: payload.paddleId,
      email: payload.email,
      // Tokens without `iat` count as issued at 0, so any logout watermark revokes them.
      iat: typeof payload.iat === 'number' ? payload.iat : 0,
    }
  } catch {
    return null
  }
}
