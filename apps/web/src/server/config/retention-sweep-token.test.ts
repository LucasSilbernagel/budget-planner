import {
  SESSION_SECRET_MIN_DISTINCT_CHARS,
  SESSION_SECRET_MIN_LENGTH,
  getRetentionSweepToken,
  resetConfig,
} from '@budget-planner/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  resetConfig()
})

function withToken(value: string | undefined) {
  vi.stubEnv('RETENTION_SWEEP_TOKEN', value)
  resetConfig()
  return getRetentionSweepToken()
}

describe('getRetentionSweepToken', () => {
  it('is undefined when unset', () => {
    expect(withToken(undefined)).toBeUndefined()
  })

  it('is undefined when blank', () => {
    expect(withToken('   ')).toBeUndefined()
  })

  it('is undefined one character below the minimum length', () => {
    expect(
      withToken('0123456789abcdef'.repeat(4).slice(0, SESSION_SECRET_MIN_LENGTH - 1))
    ).toBeUndefined()
  })

  it('is undefined for a long but low-entropy token (review fix: same floor as SESSION_SECRET)', () => {
    expect(withToken('a'.repeat(SESSION_SECRET_MIN_LENGTH))).toBeUndefined()
    expect(withToken('abcdefg'.repeat(10).slice(0, SESSION_SECRET_MIN_LENGTH))).toBeUndefined()
    expect(SESSION_SECRET_MIN_DISTINCT_CHARS).toBeGreaterThan(7)
  })

  it('returns the trimmed token at the minimum length', () => {
    const token = '0123456789abcdef'.repeat(4).slice(0, SESSION_SECRET_MIN_LENGTH)
    expect(withToken(`  ${token}\n`)).toBe(token)
  })
})
