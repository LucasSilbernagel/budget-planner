import { describe, expect, it } from 'vitest'
import { decimalCommaToPoint } from '../percent-text'

describe('decimalCommaToPoint (Story 110.1, FR178, D3)', () => {
  it.each([
    ['2,5', '2.5'],
    ['2,5%', '2.5%'],
    [' 2,5 % ', ' 2.5 % '],
    ['-2,5', '-2.5'],
    [',5', '.5'],
    ['2,', '2.'],
  ])('reads the single comma in %j as the decimal point', (raw, expected) => {
    expect(decimalCommaToPoint(raw)).toBe(expected)
  })

  it.each([['2.5'], ['1.000,5'], ['2,5,1'], ['1,000.5'], ['abc'], ['']])(
    'leaves %j unchanged',
    (raw) => {
      expect(decimalCommaToPoint(raw)).toBe(raw)
    }
  )
})
