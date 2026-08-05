import { describe, expect, it } from 'vitest'
import { sanitizeMoneyChange, sanitizeWithCaret } from '../sanitized-input'

/**
 * Caret-preserving sanitization glue (story 28-1, FR46).
 *
 * The bug these exist for is invisible to a value-only assertion: the field ends
 * up holding the right string while the cursor silently jumps to the end, so
 * mid-string editing becomes impossible. Every case below therefore asserts the
 * SELECTION as well as the value.
 */
function inputWith(value: string, caret: number): HTMLInputElement {
  const input = document.createElement('input')
  input.value = value
  input.setSelectionRange(caret, caret)
  return input
}

describe('sanitizeWithCaret', () => {
  it('leaves the node untouched when the filter is a no-op', () => {
    const input = inputWith('1234', 2)
    const result = sanitizeWithCaret(input, (raw) => raw)

    expect(result).toBe('1234')
    // Untouched means React keeps its normal controlled-input behaviour here.
    expect(input.value).toBe('1234')
    expect(input.selectionStart).toBe(2)
  })

  it('keeps the caret in place when a character is rejected mid-string', () => {
    // "1,2|34.56" with an 'x' just typed at index 3 → "1,2x|34.56", caret 4.
    const input = inputWith('1,2x34.56', 4)
    const result = sanitizeWithCaret(input, (raw) => raw.replace(/x/g, ''))

    expect(result).toBe('1,234.56')
    expect(input.value).toBe('1,234.56')
    // The caret must sit where the rejected character was, NOT at the end (8).
    expect(input.selectionStart).toBe(3)
    expect(input.selectionEnd).toBe(3)
  })

  it('accounts for every character dropped before the caret, not just one', () => {
    const input = inputWith('aa1aa2', 5)
    const result = sanitizeWithCaret(input, (raw) => raw.replace(/a/g, ''))

    expect(result).toBe('12')
    // Four 'a's precede index 5, of which four are dropped → caret lands after '1'.
    expect(input.selectionStart).toBe(1)
  })

  it('does not throw on an input type that does not support selection', () => {
    // Browsers report selectionStart === null for these types AND throw
    // InvalidStateError from setSelectionRange (verified in Chromium for
    // type="number"). Stub BOTH to match: a getter-only stub on a text input
    // would leave setSelectionRange working and quietly miss the throw.
    const input = document.createElement('input')
    input.value = 'abc123'
    Object.defineProperty(input, 'selectionStart', { value: null, configurable: true })
    input.setSelectionRange = () => {
      throw new DOMException('not supported', 'InvalidStateError')
    }

    let result = ''
    expect(() => {
      result = sanitizeWithCaret(input, (raw) => raw.replace(/[a-z]/g, ''))
    }).not.toThrow()
    expect(result).toBe('123')
    expect(input.value).toBe('123')
  })
})

describe('sanitizeMoneyChange', () => {
  it('rejects a letter typed mid-amount without moving the caret', () => {
    const input = inputWith('1,2x34.56', 4)

    expect(sanitizeMoneyChange(input, 'en-US')).toBe('1,234.56')
    expect(input.value).toBe('1,234.56')
    expect(input.selectionStart).toBe(3)
  })

  it('is locale-aware — a de-DE group separator survives', () => {
    const input = inputWith('1.234,56x', 9)

    expect(sanitizeMoneyChange(input, 'de-DE')).toBe('1.234,56')
    expect(input.selectionStart).toBe(8)
  })

  it('keeps the caret in bounds when the exponent tail is truncated', () => {
    // The exponent rule is a LOOKAHEAD (it needs the digit after the 'e'), so it
    // is the one part of the filter that is not purely left-to-right. Verify the
    // derived caret can never overshoot the sanitized string.
    for (const caret of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const input = inputWith('1.2E+09', Math.min(caret, 7))
      const result = sanitizeMoneyChange(input, 'en-US')
      expect(result).toBe('1.2')
      expect(input.selectionStart).toBeLessThanOrEqual(result.length)
      expect(input.selectionStart).toBeGreaterThanOrEqual(0)
    }
  })

  it('leaves a clean amount and its caret completely alone', () => {
    const input = inputWith('1,234.56', 3)

    expect(sanitizeMoneyChange(input, 'en-US')).toBe('1,234.56')
    expect(input.selectionStart).toBe(3)
  })

  it('defaults to en-US assumptions with no locale', () => {
    const input = inputWith('$50', 3)

    expect(sanitizeMoneyChange(input)).toBe('50')
  })
})
