/**
 * Error tracking (story 5-5, AC-3) — provider-agnostic, scrub-before-send.
 *
 * Scope split:
 *  - [CODE, here]   A scrub pass (reusing the logger's `redact()`) plus a
 *                   DSN-gated transport seam. With no DSN/transport configured,
 *                   `captureError` is a SAFE NO-OP — nothing ever egresses. This
 *                   protects the app's "no tracking" promise by default.
 *  - [OPS, blocked-on-account] Select the EU-resident, scrub-capable provider
 *                   (recommendation: self/EU-hosted GlitchTip — Sentry-wire-compatible,
 *                   confirm data residency before adoption; escalate if none),
 *                   create the account, inject the DSN as a Rapids runtime secret,
 *                   and plug the provider SDK in as the `transport`.
 *
 * Privacy posture: NEVER capture request bodies, cookies, auth headers, emails,
 * or financial fields. `scrubEvent` enforces this before anything is handed to a
 * transport, so scrubbing cannot be accidentally disabled at the provider layer.
 * Client-side capture is intentionally NOT wired here — server-only capture is the
 * default for a no-tracking app; revisit as an explicit, cookie-free opt-in only.
 */

import { redact } from './logger'

export interface ScrubbedEvent {
  error: { name: string; message: string }
  context?: Record<string, unknown>
}

/** A transport forwards an already-scrubbed event to the provider. */
export type ErrorTransport = (event: ScrubbedEvent) => void

interface InitOptions {
  /** Runtime secret (Rapids-injected). Absent ⇒ tracking stays disabled. */
  dsn: string | undefined
  /** Provider SDK adapter. Wired by OPS once a provider is chosen. */
  transport: ErrorTransport
}

let activeTransport: ErrorTransport | null = null

/**
 * Normalize + scrub an error and its context into a send-safe event. Pure and
 * always safe to call (used directly in tests to prove the scrub contract).
 */
export function scrubEvent(error: unknown, context?: Record<string, unknown>): ScrubbedEvent {
  const isError = error instanceof Error
  const normalized = isError
    ? error
    : new Error(typeof error === 'string' ? error : 'Non-Error thrown')

  const scrubbedError = redact(normalized) as { name: string; message: string }

  // For a non-Error, non-string throw the normalized message is uninformative
  // ("Non-Error thrown") — keep a scrubbed snapshot of the original payload so
  // the captured event stays diagnosable.
  const thrownSnapshot = !isError && typeof error !== 'string' ? { thrown: error } : undefined
  const rawContext =
    context || thrownSnapshot ? { ...thrownSnapshot, ...(context ?? {}) } : undefined

  return {
    error: scrubbedError,
    context: rawContext ? (redact(rawContext) as Record<string, unknown>) : undefined,
  }
}

/**
 * Configure error tracking. A no-DSN call leaves tracking disabled (the common
 * dev/test/pre-account case), so this is safe to call unconditionally at boot.
 */
export function initErrorTracking({ dsn, transport }: InitOptions): void {
  activeTransport = dsn ? transport : null
}

export function isErrorTrackingEnabled(): boolean {
  return activeTransport !== null
}

/**
 * Capture an error for aggregation. No-op until a provider/DSN is configured.
 * The event is scrubbed before it reaches the transport, and a failing transport
 * can never take down the request path.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!activeTransport) return
  try {
    activeTransport(scrubEvent(error, context))
  } catch {
    // telemetry must never break the app; swallow transport failures
  }
}

/** Test-only: reset module state between cases. */
export function __resetErrorTrackingForTesting(): void {
  activeTransport = null
}
