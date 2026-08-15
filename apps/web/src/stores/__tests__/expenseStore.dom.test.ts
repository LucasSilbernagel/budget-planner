/**
 * expenseStore total tests (story 32.1, FR58).
 *
 * Mirror of `incomeStore.dom.test.ts` — see that file's header for why every
 * fixture is mixed-frequency and every expectation is a hand-computed literal.
 *
 * ⚠️ This fixture deliberately normalizes DOWNWARD (215000 → 121667) while the
 * income fixture normalizes UPWARD (230000 → 241667). A sign or direction error
 * in the normalization cannot pass both suites.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useExpenseStore } from '../expenseStore'

const base = {
  userId: 0,
  categoryId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/**
 * $50 weekly + $900 monthly + $1,200 annually.
 *
 *   raw sum (what the defect returned) = 5000 + 90000 + 120000        = 215000
 *   normalized monthly                                                = 121667
 *     weekly    round(5000 × 52/12) = round(21666.66…) = 21667
 *     monthly   90000 × 1                              = 90000
 *     annually  round(120000 × 1/12)                   = 10000
 */
const MIXED_EXPENSES = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Groceries',
    amount: 5000,
    frequency: 'weekly' as const,
    ...base,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Rent',
    amount: 90000,
    frequency: 'monthly' as const,
    ...base,
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Insurance',
    amount: 120000,
    frequency: 'annually' as const,
    ...base,
  },
]

const RAW_SUM = 215000
const NORMALIZED_MONTHLY = 121667

beforeEach(() => {
  localStorage.clear()
  useExpenseStore.setState({ expenses: [] })
})

describe('expenseStore — getTotalExpenses (story 32.1, FR58)', () => {
  it('normalizes mixed frequencies to a monthly basis instead of raw-summing', () => {
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })

    expect(useExpenseStore.getState().getTotalExpenses()).toBe(NORMALIZED_MONTHLY)
  })

  it('does NOT return the raw sum (the defect this story fixes)', () => {
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })

    expect(RAW_SUM).not.toBe(NORMALIZED_MONTHLY)
    expect(useExpenseStore.getState().getTotalExpenses()).not.toBe(RAW_SUM)
  })

  it('normalizes downward when annual rows dominate, not merely "differently"', () => {
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })

    // Pins the DIRECTION. A reciprocal-multiplier bug would still produce a
    // number that differs from the raw sum, and would still pass an inequality
    // assertion on its own.
    expect(useExpenseStore.getState().getTotalExpenses()).toBeLessThan(RAW_SUM)
  })

  it('returns 0 for an empty list without NaN', () => {
    const total = useExpenseStore.getState().getTotalExpenses()

    expect(total).toBe(0)
    expect(Number.isNaN(total)).toBe(false)
  })

  it('agrees with a biweekly row normalized at 26/12', () => {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          name: 'Childcare',
          amount: 10000,
          frequency: 'biweekly',
          ...base,
        },
      ],
    })

    expect(useExpenseStore.getState().getTotalExpenses()).toBe(21667)
  })

  it('returns a number, never an object', () => {
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })

    expect(typeof useExpenseStore.getState().getTotalExpenses()).toBe('number')
  })
})

describe('expenseStore — corrupt rows are excluded, not thrown on (story 32.1)', () => {
  it('does not throw on a corrupt persisted frequency', () => {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
          ...base,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Rent',
          amount: 90000,
          frequency: 'monthly',
          ...base,
        },
      ],
    })

    expect(() => useExpenseStore.getState().getTotalExpenses()).not.toThrow()
  })

  it('excludes the unreadable row from the total rather than guessing its period', () => {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
          ...base,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Rent',
          amount: 90000,
          frequency: 'monthly',
          ...base,
        },
      ],
    })

    expect(useExpenseStore.getState().getTotalExpenses()).toBe(90000)
  })

  it('counts unreadable rows so the page can disclose them', () => {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
          ...base,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Rent',
          amount: 90000,
          frequency: 'monthly',
          ...base,
        },
      ],
    })

    expect(useExpenseStore.getState().getUnreadableExpenseCount()).toBe(1)
  })

  it('reports zero unreadable rows for clean data', () => {
    useExpenseStore.setState({ expenses: MIXED_EXPENSES })

    expect(useExpenseStore.getState().getUnreadableExpenseCount()).toBe(0)
  })
  /**
   * ⚠️ Code review 32.1. A persisted array can carry a `null` or primitive
   * element (truncated write, hand-edited storage, an older bug). The persist
   * `migrate` filters those — but zustand only runs `migrate` on a version
   * MISMATCH, so a blob already at the current version delivers the bad element
   * straight into state. Reading `.frequency` off it throws on the render path
   * and white-screens the page the guard exists to protect.
   */
  it.each([null, undefined, 42, 'nonsense'])(
    'does not throw when the persisted array contains %p',
    (bad) => {
      useExpenseStore.setState({ expenses: [MIXED_EXPENSES[1], bad as never] })

      expect(() => useExpenseStore.getState().getTotalExpenses()).not.toThrow()
      expect(useExpenseStore.getState().getTotalExpenses()).toBe(90000)
      expect(useExpenseStore.getState().getUnreadableExpenseCount()).toBe(1)
    }
  )
})
