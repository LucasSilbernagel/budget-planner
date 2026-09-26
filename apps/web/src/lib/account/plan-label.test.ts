import { describe, expect, it } from 'vitest'
import { planLabel } from './plan-label'

/**
 * Story 70.1 — D-LABEL, approved by Lucas 2026-09-25. Every status × every
 * interval state, so a change to any single cell goes red.
 */
describe('planLabel', () => {
  it.each([
    ['lifetime', 'year', 'Lifetime Plan'],
    ['lifetime', 'month', 'Lifetime Plan'],
    ['lifetime', null, 'Lifetime Plan'],
    ['active', 'year', 'Annual Plan'],
    ['active', 'month', 'Monthly Plan'],
    // AC-6: a row that predates the column degrades to the pre-70.1 text.
    ['active', null, 'Active'],
    ['past_due', 'year', 'Annual Plan · payment overdue'],
    ['past_due', 'month', 'Monthly Plan · payment overdue'],
    ['past_due', null, 'Payment overdue'],
    // Not plans: a stored interval must NOT surface a plan name.
    ['canceled', 'year', 'Cancelled'],
    ['canceled', 'month', 'Cancelled'],
    ['canceled', null, 'Cancelled'],
    ['free', 'year', 'Free'],
    ['free', 'month', 'Free'],
    ['free', null, 'Free'],
  ] as const)('%s + %s → %s', (status, interval, expected) => {
    expect(planLabel(status, interval)).toBe(expected)
  })

  it('treats an ABSENT interval (an older server) exactly like null', () => {
    expect(planLabel('active', undefined)).toBe('Active')
    expect(planLabel('past_due', undefined)).toBe('Payment overdue')
  })

  it('labels a status OUTSIDE the enum neutrally, never with the raw value (review)', () => {
    // `/api/auth/me` is an unvalidated cast, so a newer server's sixth status
    // can reach a client that does not know it.
    const label = planLabel('paused' as never, 'year')
    expect(label).toBe('Unknown plan')
    expect(label).not.toContain('paused')
  })

  it('never returns a raw enum value or an underscore', () => {
    for (const status of ['free', 'active', 'past_due', 'canceled', 'lifetime'] as const) {
      for (const interval of ['month', 'year', null] as const) {
        const label = planLabel(status, interval)
        expect(label).not.toContain('_')
        expect(label).not.toBe(status)
      }
    }
  })
})
