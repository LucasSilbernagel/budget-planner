/** A no-op until a DSN and transport are configured; events are scrubbed before any transport sees them. */

import { redact } from './logger'

export interface ScrubbedEvent {
  error: { name: string; message: string }
  context?: Record<string, unknown>
}

type ErrorTransport = (event: ScrubbedEvent) => void

interface InitOptions {
  dsn: string | undefined
  transport: ErrorTransport
}

let activeTransport: ErrorTransport | null = null

export function scrubEvent(error: unknown, context?: Record<string, unknown>): ScrubbedEvent {
  const isError = error instanceof Error
  const normalized = isError
    ? error
    : new Error(typeof error === 'string' ? error : 'Non-Error thrown')

  const scrubbedError = redact(normalized) as { name: string; message: string }

  const thrownSnapshot = !isError && typeof error !== 'string' ? { thrown: error } : undefined
  const rawContext =
    context || thrownSnapshot ? { ...thrownSnapshot, ...(context ?? {}) } : undefined

  return {
    error: scrubbedError,
    context: rawContext ? (redact(rawContext) as Record<string, unknown>) : undefined,
  }
}

export function initErrorTracking({ dsn, transport }: InitOptions): void {
  activeTransport = dsn ? transport : null
}

export function isErrorTrackingEnabled(): boolean {
  return activeTransport !== null
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!activeTransport) return
  try {
    activeTransport(scrubEvent(error, context))
  } catch {
    // telemetry must never break the app
  }
}

export function __resetErrorTrackingForTesting(): void {
  activeTransport = null
}
