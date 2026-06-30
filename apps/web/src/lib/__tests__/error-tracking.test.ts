/**
 * Error-tracking tests (story 5-5, AC-3)
 *
 * The CODE deliverable is provider-agnostic: scrub-before-send + a DSN-gated
 * transport seam. Selecting the EU-hosted provider, creating the account, and
 * injecting the real DSN are OPS (blocked-on-account). These tests prove the two
 * things that matter for the privacy promise regardless of provider:
 *   1. without a configured transport/DSN, capture is a safe no-op (nothing egresses);
 *   2. with a (mocked) transport, the event is fully scrubbed before send.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetErrorTrackingForTesting,
  captureError,
  initErrorTracking,
  isErrorTrackingEnabled,
  scrubEvent,
} from '../error-tracking'

afterEach(() => __resetErrorTrackingForTesting())

describe('scrubEvent()', () => {
  it('strips PII / financial / secret fields from error + context before send', () => {
    const event = scrubEvent(new Error('checkout failed for jane@example.com'), {
      userId: 'u-123', // non-PII — kept
      email: 'jane@example.com', // PII — redacted
      amount: 4200, // financial — redacted
      sessionToken: 'abc.def', // secret — redacted
    })

    expect(event.error.name).toBe('Error')
    expect(event.error.message).toBe('checkout failed for [REDACTED]')
    expect(event.context?.userId).toBe('u-123')
    expect(event.context?.email).toBe('[REDACTED]')
    expect(event.context?.amount).toBe('[REDACTED]')
    expect(event.context?.sessionToken).toBe('[REDACTED]')
    expect(JSON.stringify(event)).not.toContain('jane@example.com')
  })

  it('retains a scrubbed snapshot of a non-Error throw in context.thrown', () => {
    const event = scrubEvent({ code: 'E_X', email: 'jane@example.com', amount: 99 })
    const thrown = event.context?.thrown as Record<string, unknown>
    expect(thrown.code).toBe('E_X')
    expect(thrown.email).toBe('[REDACTED]')
    expect(thrown.amount).toBe('[REDACTED]')
  })
})

describe('captureError()', () => {
  beforeEach(() => __resetErrorTrackingForTesting())

  it('is a no-op when not initialized (no DSN/provider yet — OPS gated)', () => {
    expect(isErrorTrackingEnabled()).toBe(false)
    expect(() => captureError(new Error('boom'), { email: 'x@y.com' })).not.toThrow()
  })

  it('does NOT enable when initialized without a DSN', () => {
    const transport = vi.fn()
    initErrorTracking({ dsn: undefined, transport })
    expect(isErrorTrackingEnabled()).toBe(false)
    captureError(new Error('boom'))
    expect(transport).not.toHaveBeenCalled()
  })

  it('forwards a scrubbed event to the transport once a DSN is configured', () => {
    const transport = vi.fn()
    initErrorTracking({ dsn: 'https://key@errors.eu.example/1', transport })
    expect(isErrorTrackingEnabled()).toBe(true)

    captureError(new Error('webhook failed'), { email: 'a@b.com', paddleUserId: 'pad_1' })

    expect(transport).toHaveBeenCalledTimes(1)
    const sent = transport.mock.calls[0][0]
    expect(sent.context.paddleUserId).toBe('pad_1')
    expect(sent.context.email).toBe('[REDACTED]')
    expect(sent.error.message).toBe('webhook failed')
  })

  it('never throws if the transport itself fails', () => {
    const transport = vi.fn(() => {
      throw new Error('transport down')
    })
    initErrorTracking({ dsn: 'https://key@errors.eu.example/1', transport })
    expect(() => captureError(new Error('boom'))).not.toThrow()
  })
})
