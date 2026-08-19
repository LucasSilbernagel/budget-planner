import { describe, expect, it } from 'vitest'
import {
  type SortState,
  ariaSortFor,
  compareDefinedValues,
  compareRowsBy,
  nextSortState,
  sortRowsBy,
} from '../table-sort'

/**
 * The pure sort layer for story 34.2 (FR61).
 *
 * ⚠️ Every ordering expectation here is written out as a LITERAL sequence. A
 * guard that derives its expected order from the same helper it is guarding
 * cannot fail (33.2's lesson), and this module's whole job is to produce an
 * order.
 */

interface Row {
  id: string
  value: number | null
  text: string
}

const row = (id: string, value: number | null, text = id): Row => ({ id, value, text })
const byValue = (r: Row) => r.value
const byText = (r: Row) => r.text
const ids = (rows: readonly Row[]) => rows.map((r) => r.id)

describe('compareDefinedValues', () => {
  it('orders numbers without subtracting them', () => {
    expect(compareDefinedValues(1, 2)).toBe(-1)
    expect(compareDefinedValues(2, 1)).toBe(1)
    expect(compareDefinedValues(2, 2)).toBe(0)
  })

  it('never returns NaN for infinities', () => {
    // Subtraction would give NaN here, and `ordering.ts` records what a NaN
    // comparator does to an array: undefined behaviour, silently.
    expect(compareDefinedValues(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(0)
    expect(compareDefinedValues(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(-1)
    expect(Number.isNaN(compareDefinedValues(Number.POSITIVE_INFINITY, 5))).toBe(false)
  })

  it('orders negative money below positive money', () => {
    expect(compareDefinedValues(-500_00, 10)).toBe(-1)
  })

  it('collates strings with locale awareness', () => {
    expect(compareDefinedValues('apple', 'banana')).toBeLessThan(0)
    // Case-insensitive collation is the point of localeCompare here: a raw `<`
    // would sort every capitalised name above every lowercase one.
    expect(compareDefinedValues('apple', 'Banana')).toBeLessThan(0)
    expect(compareDefinedValues('Zebra', 'apple')).toBeGreaterThan(0)
  })
})

describe('compareRowsBy — absent values', () => {
  it('places an absent value last under BOTH directions', () => {
    const present = row('a', 5)
    const absent = row('b', null)
    expect(compareRowsBy(present, absent, byValue, 'asc')).toBe(-1)
    expect(compareRowsBy(absent, present, byValue, 'asc')).toBe(1)
    // The direction flip must NOT reach the absence branches.
    expect(compareRowsBy(present, absent, byValue, 'desc')).toBe(-1)
    expect(compareRowsBy(absent, present, byValue, 'desc')).toBe(1)
  })

  it('treats two absent values as tied', () => {
    expect(compareRowsBy(row('a', null), row('b', null), byValue, 'asc')).toBe(0)
    expect(compareRowsBy(row('a', null), row('b', null), byValue, 'desc')).toBe(0)
  })
})

describe('sortRowsBy', () => {
  it('orders ascending and descending', () => {
    const rows = [row('a', 3), row('b', 1), row('c', 2)]
    expect(ids(sortRowsBy(rows, byValue, 'asc'))).toEqual(['b', 'c', 'a'])
    expect(ids(sortRowsBy(rows, byValue, 'desc'))).toEqual(['a', 'c', 'b'])
  })

  it('keeps absent values last in both directions, not merely reversed', () => {
    // ⚠️ This is the assertion that distinguishes a negated comparator from a
    // `.reverse()` of the ascending result. Under `.reverse()` the descending
    // order would be ['x','a','c','b'] with the absence FIRST.
    const rows = [row('a', 3), row('x', null), row('b', 1), row('c', 2)]
    expect(ids(sortRowsBy(rows, byValue, 'asc'))).toEqual(['b', 'c', 'a', 'x'])
    expect(ids(sortRowsBy(rows, byValue, 'desc'))).toEqual(['a', 'c', 'b', 'x'])
  })

  it('leaves tied rows in their INPUT order, in both directions', () => {
    // ⚠️ The tie fixture that can actually fail. `b` and `c` tie on the sort key
    // but sit in a known input order, and `a`/`d` bracket them so a whole-array
    // reversal is visible too. A fixture whose tied rows are also adjacent in
    // the order the comparator would produce anyway proves nothing (34.1a M10,
    // 34.1b M6 — third story running).
    const rows = [row('a', 1), row('b', 5), row('c', 5), row('d', 9)]
    expect(ids(sortRowsBy(rows, byValue, 'asc'))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(sortRowsBy(rows, byValue, 'desc'))).toEqual(['d', 'b', 'c', 'a'])
  })

  it('does not mutate the input array', () => {
    const rows = [row('a', 3), row('b', 1)]
    const sorted = sortRowsBy(rows, byValue, 'asc')
    expect(ids(rows)).toEqual(['a', 'b'])
    expect(sorted).not.toBe(rows)
  })

  it('sorts text keys alphabetically', () => {
    const rows = [row('a', 1, 'Zebra'), row('b', 2, 'apple'), row('c', 3, 'Mango')]
    expect(ids(sortRowsBy(rows, byText, 'asc'))).toEqual(['b', 'c', 'a'])
  })
})

describe('nextSortState — the three-state cycle', () => {
  it('walks none -> ascending -> descending -> none for one column', () => {
    const first = nextSortState<'amount'>(null, 'amount')
    expect(first).toEqual({ key: 'amount', direction: 'asc' })
    const second = nextSortState(first, 'amount')
    expect(second).toEqual({ key: 'amount', direction: 'desc' })
    // The third activation is what returns the table to manual order — it is
    // the whole reason there is no separate reset button at >= 640px.
    expect(nextSortState(second, 'amount')).toBeNull()
  })

  it('starts a DIFFERENT column at ascending and drops the previous one', () => {
    const current: SortState<'amount' | 'name'> = { key: 'amount', direction: 'desc' }
    expect(nextSortState(current, 'name')).toEqual({ key: 'name', direction: 'asc' })
  })
})

describe('ariaSortFor', () => {
  it('reports none for every column when nothing is sorted', () => {
    expect(ariaSortFor(null, 'amount')).toBe('none')
  })

  it('reports the direction for the active column only', () => {
    const current: SortState<'amount' | 'name'> = { key: 'amount', direction: 'asc' }
    expect(ariaSortFor(current, 'amount')).toBe('ascending')
    expect(ariaSortFor(current, 'name')).toBe('none')
    expect(ariaSortFor({ key: 'amount', direction: 'desc' } as const, 'amount')).toBe('descending')
  })
})
