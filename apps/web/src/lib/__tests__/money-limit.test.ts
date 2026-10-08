import { MAX_MONEY_CENTS } from '@budget-planner/core'
import { describe, expect, it } from 'vitest'
import { exceedsMoneyLimit, moneyLimitMessage } from '../money-limit'

describe('exceedsMoneyLimit', () => {
  it('is false at the limit and true one cent over', () => {
    expect(exceedsMoneyLimit(MAX_MONEY_CENTS)).toBe(false)
    expect(exceedsMoneyLimit(MAX_MONEY_CENTS + 1)).toBe(true)
  })
})

describe('moneyLimitMessage', () => {
  it.each([
    [{ mode: 'symbol', currency: 'USD' }, 'Enter an amount up to $21,474,836.47'],
    // Yen has no minor unit on display: the limit shows rounded, and a typed
    // ¥21,474,836 (2,147,483,600 cents) is under it.
    [{ mode: 'symbol', currency: 'JPY' }, 'Enter an amount up to ¥21,474,836'],
    [{ mode: 'none', currency: 'NONE' }, 'Enter an amount up to 21,474,836.47'],
    // de-DE puts a NO-BREAK SPACE (U+00A0) before the euro sign.
    [
      { mode: 'symbol', currency: 'EUR', locale: 'de-DE' },
      'Enter an amount up to 21.474.836,47\u00a0€',
    ],
  ] as const)('%o', (preferences, expected) => {
    expect(moneyLimitMessage(preferences)).toBe(expected)
  })
})
