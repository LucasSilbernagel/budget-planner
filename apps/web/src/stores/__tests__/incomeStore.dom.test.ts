/**
 * incomeStore total tests (story 32.1, FR58).
 *
 * ⚠️ WHY THIS FILE EXISTS. Before 32.1 there was NO unit test anywhere asserting
 * on `getTotalIncome()`, which is why a frequency-blind `reduce` shipped and
 * survived: the Income page showed a raw sum while the Overview showed the
 * normalized one, from identical data.
 *
 * ⚠️ EVERY FIXTURE HERE IS MIXED-FREQUENCY, BY NECESSITY. At a single frequency
 * the raw sum and the normalized sum are EQUAL, so a single-frequency fixture
 * passes against both the broken and the fixed implementation and proves
 * nothing. Every existing income fixture in the repo (and the `makeIncomeSource`
 * factory's default) is `'monthly'` — that is precisely the blind spot.
 *
 * Expectations are HAND-COMPUTED literals, never re-derived by calling
 * `normalizeToMonthly`: a test that recomputes with the implementation's own
 * helper passes even if the multiplier is wrong (see build-financial-summary's
 * test header for the same rule).
 *
 * Runs in jsdom (`.dom.test.ts`) for a real `localStorage` — the store uses the
 * zustand persist middleware, and `setState` goes through the WRITE path even
 * with `skipHydration`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useIncomeStore } from '../incomeStore'

const base = {
  userId: 0,
  categoryId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/**
 * The epic's own example: $200 weekly + $1,500 monthly + $600 annually.
 *
 *   raw sum (what the defect returned) = 20000 + 150000 + 60000       = 230000
 *   normalized monthly                                                = 241667
 *     weekly    round(20000 × 52/12) = round(86666.66…) = 86667
 *     monthly   150000 × 1                              = 150000
 *     annually  round(60000 × 1/12)                     = 5000
 *
 * The two differ by 11667c, so this fixture can actually detect the defect.
 */
const MIXED_INCOME = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Side gig',
    amount: 20000,
    frequency: 'weekly' as const,
    ...base,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Salary',
    amount: 150000,
    frequency: 'monthly' as const,
    ...base,
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Bonus',
    amount: 60000,
    frequency: 'annually' as const,
    ...base,
  },
]

const RAW_SUM = 230000
const NORMALIZED_MONTHLY = 241667

beforeEach(() => {
  localStorage.clear()
  useIncomeStore.setState({ incomeSources: [] })
})

describe('incomeStore — getTotalIncome (story 32.1, FR58)', () => {
  it('normalizes mixed frequencies to a monthly basis instead of raw-summing', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })

    expect(useIncomeStore.getState().getTotalIncome()).toBe(NORMALIZED_MONTHLY)
  })

  it('does NOT return the raw sum (the defect this story fixes)', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })

    // Guards the assertion above from being satisfied by accident: if these two
    // were ever equal, the test above could not distinguish broken from fixed.
    expect(RAW_SUM).not.toBe(NORMALIZED_MONTHLY)
    expect(useIncomeStore.getState().getTotalIncome()).not.toBe(RAW_SUM)
  })

  it('returns 0 for an empty list without NaN', () => {
    const total = useIncomeStore.getState().getTotalIncome()

    expect(total).toBe(0)
    expect(Number.isNaN(total)).toBe(false)
  })

  it('agrees with a biweekly row normalized at 26/12', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          name: 'Stipend',
          amount: 10000,
          frequency: 'biweekly',
          ...base,
        },
      ],
    })

    // round(10000 × 26/12) = round(21666.66…) = 21667
    expect(useIncomeStore.getState().getTotalIncome()).toBe(21667)
  })

  it('returns a number, never an object', () => {
    // `useTotalIncome` calls this getter INSIDE the zustand selector. Returning
    // a fresh object would fail v4's Object.is equality on every render and
    // produce an infinite re-render loop.
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })

    expect(typeof useIncomeStore.getState().getTotalIncome()).toBe('number')
  })
})

describe('incomeStore — corrupt rows are excluded, not thrown on (story 32.1)', () => {
  /**
   * ⚠️ REGRESSION GUARD FOR THE FIX ITSELF. Before 32.1 the getter never read
   * `frequency`, so it could not throw. Delegating to core exposes
   * `validateFrequency`, which THROWS on anything outside the four-value set —
   * and localStorage is user-editable while the sync applier writes rows without
   * validating. An unguarded getter white-screens /income the same way a corrupt
   * row already white-screens the dashboard (deferred-work.md:524).
   */
  it('does not throw on a corrupt persisted frequency', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
          ...base,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Salary',
          amount: 150000,
          frequency: 'monthly',
          ...base,
        },
      ],
    })

    expect(() => useIncomeStore.getState().getTotalIncome()).not.toThrow()
  })

  it('excludes the unreadable row from the total rather than guessing its period', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
          ...base,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Salary',
          amount: 150000,
          frequency: 'monthly',
          ...base,
        },
      ],
    })

    // Only the readable monthly row contributes. Coercing the corrupt row to
    // 'monthly' would report 160000 — a number the user never entered, shown as
    // fact. Excluding + disclosing is the report's precedent and the right one
    // for a headline total.
    expect(useIncomeStore.getState().getTotalIncome()).toBe(150000)
  })

  it('does not throw on a non-finite amount', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Broken',
          amount: Number.NaN,
          frequency: 'monthly',
          ...base,
        },
      ],
    })

    expect(() => useIncomeStore.getState().getTotalIncome()).not.toThrow()
    expect(useIncomeStore.getState().getTotalIncome()).toBe(0)
  })

  it('counts unreadable rows so the page can disclose them', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          name: 'Corrupt',
          amount: 10000,
          frequency: 'daily' as never,
          ...base,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Salary',
          amount: 150000,
          frequency: 'monthly',
          ...base,
        },
      ],
    })

    expect(useIncomeStore.getState().getUnreadableIncomeCount()).toBe(1)
  })

  it('reports zero unreadable rows for clean data', () => {
    useIncomeStore.setState({ incomeSources: MIXED_INCOME })

    expect(useIncomeStore.getState().getUnreadableIncomeCount()).toBe(0)
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
      useIncomeStore.setState({ incomeSources: [MIXED_INCOME[1], bad as never] })

      expect(() => useIncomeStore.getState().getTotalIncome()).not.toThrow()
      expect(useIncomeStore.getState().getTotalIncome()).toBe(150000)
      expect(useIncomeStore.getState().getUnreadableIncomeCount()).toBe(1)
    }
  )
})
