import { describe, expect, it } from 'vitest'
import { parseAge, parseCurrencyToCents, parsePercentageToDecimal } from '../retirement-parsers'

/**
 * Strict retirement input parsers (story 29.1, AC-8).
 *
 * These replace the three duplicate `parseCurrencyToCents` copies and the two
 * duplicate `parsePercentageToDecimal` copies that lived inside
 * `RetirementAccumulationPlanner` and `RetirementForm`. The merge is also where
 * the long-standing dead-guard bug is fixed, so the corruption cases below are
 * the point of this file — not incidental coverage.
 */
describe('parseCurrencyToCents', () => {
  it('parses plain and grouped en-US amounts', () => {
    expect(parseCurrencyToCents('123.45')).toBe(12_345)
    expect(parseCurrencyToCents('1,000.00')).toBe(100_000)
    expect(parseCurrencyToCents('$1,000.00')).toBe(100_000)
    expect(parseCurrencyToCents('1,234,567.89', 'en-US')).toBe(123_456_789)
  })

  it('parses a de-DE amount using that locale’s separators', () => {
    // group '.', decimal ',' — the inverse of en-US, so a naive '.'-as-decimal
    // reading would return 1_234_567_89 cents from a completely different number.
    expect(parseCurrencyToCents('1.234.567,89', 'de-DE')).toBe(123_456_789)
  })

  it('treats an empty or whitespace-only value as 0', () => {
    expect(parseCurrencyToCents('')).toBe(0)
    expect(parseCurrencyToCents('   ')).toBe(0)
  })

  it('rounds to the nearest cent rather than truncating', () => {
    expect(parseCurrencyToCents('1.006')).toBe(101)
    expect(parseCurrencyToCents('0.014')).toBe(1)
    // Exact half-cents land wherever IEEE-754 puts `value * 100` — "1.005"
    // is really 100.49999999999999, so it rounds DOWN. Pinned as the shipped
    // behaviour (unchanged by this story's merge), not as a desired rule; money
    // inputs are two-decimal in practice so this boundary is not reachable from
    // the UI.
    expect(parseCurrencyToCents('1.005')).toBe(100)
  })

  /**
   * ⚠️ The dead-guard bug this story fixes (story 26.7 review, deferred).
   *
   * Both former copies ran `cleaned = trimmed.replace(/[^\d.]/g, '')` BEFORE
   * their `e`/`E` and non-numeric guards, so the guards could never fire: the
   * offending characters had already been deleted. Two silent money-corruption
   * paths resulted — the parser returned a plausible number for input the user
   * never entered, with no error anywhere.
   */
  it('rejects scientific notation instead of silently reading "1e5" as $15', () => {
    expect(() => parseCurrencyToCents('1e5')).toThrow(/scientific notation/)
    expect(() => parseCurrencyToCents('1E5')).toThrow(/scientific notation/)
  })

  it('rejects embedded letters instead of silently reading "12x34" as $12.34', () => {
    expect(() => parseCurrencyToCents('12x34')).toThrow(/non-numeric/)
    expect(() => parseCurrencyToCents('12 apples 34')).toThrow(/non-numeric/)
  })

  it('still rejects the cases the old guards did catch', () => {
    expect(() => parseCurrencyToCents('-100')).toThrow(/negative/)
    expect(() => parseCurrencyToCents('1.2.3')).toThrow(/multiple decimal points/)
    expect(() => parseCurrencyToCents('999999999999999999')).toThrow(/safe integer/)
    expect(() => parseCurrencyToCents(null as unknown as string)).toThrow(/null or undefined/)
  })
})

describe('parsePercentageToDecimal', () => {
  it('converts percent strings to decimals', () => {
    expect(parsePercentageToDecimal('6')).toBeCloseTo(0.06, 10)
    expect(parsePercentageToDecimal('6%')).toBeCloseTo(0.06, 10)
    expect(parsePercentageToDecimal('6.5')).toBeCloseTo(0.065, 10)
    expect(parsePercentageToDecimal('')).toBe(0)
  })

  it('rejects malformed percentages', () => {
    expect(() => parsePercentageToDecimal('-6')).toThrow(/negative/)
    expect(() => parsePercentageToDecimal('6e2')).toThrow(/scientific notation/)
    expect(() => parsePercentageToDecimal('6x')).toThrow(/non-numeric/)
    expect(() => parsePercentageToDecimal('1.2.3')).toThrow(/multiple decimal points/)
  })
})

describe('parseAge', () => {
  it('parses whole years and treats empty as "not provided"', () => {
    expect(parseAge('35')).toBe(35)
    expect(parseAge('')).toBeNull()
    expect(parseAge('   ')).toBeNull()
  })

  it('rejects fractional, negative and non-numeric ages', () => {
    expect(() => parseAge('35.5')).toThrow(/whole number/)
    expect(() => parseAge('-1')).toThrow(/whole number/)
    expect(() => parseAge('thirty')).toThrow(/whole number/)
  })
})
