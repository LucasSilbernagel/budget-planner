/**
 * `summarizeEndingExpenses` (story 65.2, FR101).
 *
 * Concrete numbers throughout — the epic-24 lesson: a pure helper is worth
 * extracting only if both branches are tested with real floors, not shapes.
 */

import { describe, expect, it } from 'vitest'
import { isMarked, summarizeEndingExpenses } from '../retirement-ending-expenses'

const row = (extra: Record<string, unknown> = {}) => ({
  amount: 100_000,
  frequency: 'monthly',
  ...extra,
})

describe('isMarked — `=== true`, never truthy', () => {
  it('is true only for a real boolean true', () => {
    expect(isMarked(row({ endsBeforeRetirement: true }) as never)).toBe(true)
  })

  it.each([
    ['absent', {}],
    ['false', { endsBeforeRetirement: false }],
    ['undefined', { endsBeforeRetirement: undefined }],
  ])('is false when the key is %s', (_label, extra) => {
    expect(isMarked(row(extra) as never)).toBe(false)
  })

  it('⚠️ is false for a persisted TRUTHY STRING — localStorage is user-editable', () => {
    // A `"false"` string is truthy. A truthy read here would mark a row the user
    // never ticked and silently cut their retirement target.
    expect(isMarked(row({ endsBeforeRetirement: 'false' }) as never)).toBe(false)
    expect(isMarked(row({ endsBeforeRetirement: 'true' }) as never)).toBe(false)
    expect(isMarked(row({ endsBeforeRetirement: 1 }) as never)).toBe(false)
  })
})

describe('summarizeEndingExpenses — nothing marked', () => {
  it('returns `none` for an empty list', () => {
    expect(summarizeEndingExpenses([])).toEqual({ state: 'none' })
  })

  it('returns `none` when rows exist but none is marked', () => {
    expect(summarizeEndingExpenses([row(), row({ amount: 50_000 })])).toEqual({ state: 'none' })
  })

  it('⚠️ returns `none` rather than `unreadable` when the only corrupt row is unmarked', () => {
    // `none` short-circuits FIRST: with nothing marked there is no suggestion to
    // make, so there is nothing to refuse either. Showing a refusal notice to a
    // user who never used the feature would be noise.
    expect(summarizeEndingExpenses([{ amount: 'oops', frequency: 'monthly' }])).toEqual({
      state: 'none',
    })
  })
})

describe('summarizeEndingExpenses — the figures', () => {
  it('sums a single marked monthly row', () => {
    const result = summarizeEndingExpenses([
      row({ amount: 180_000, endsBeforeRetirement: true }),
      row({ amount: 240_000 }),
    ])
    expect(result).toEqual({
      state: 'ok',
      totalMonthlyCents: 420_000,
      markedMonthlyCents: 180_000,
      remainingMonthlyCents: 240_000,
    })
  })

  it('⚠️ NORMALIZES a non-monthly cadence rather than summing raw amounts', () => {
    // $100.00/week marked, $1,200.00/yr unmarked.
    //
    // ⚠️ MEASURED: core multiplies by the EXACT fractions 52/12, 26/12 and 1/12
    // (`packages/core/src/finance/normalization.ts:27-30`), NOT by the rounded
    // 4.333 / 2.167 / 0.083 that `project-context.md` and this story's epic both
    // quote, and it `Math.round`s each item individually. Computing the expected
    // value from the rounded decimals gives 43_330 and fails by 3 cents — which
    // reads exactly like a real defect. Do the arithmetic with the fractions:
    //   weekly   10_000c x 52/12 = 43_333.33… -> round = 43_333c
    //   annually 120_000c x 1/12 = 10_000     -> round = 10_000c
    const result = summarizeEndingExpenses([
      row({ amount: 10_000, frequency: 'weekly', endsBeforeRetirement: true }),
      row({ amount: 120_000, frequency: 'annually' }),
    ])
    expect(result).toMatchObject({ state: 'ok', markedMonthlyCents: 43_333 })
    const ok = result as Extract<typeof result, { state: 'ok' }>
    expect(ok.totalMonthlyCents).toBe(53_333)
    expect(ok.remainingMonthlyCents).toBe(10_000)
    // The raw sum, pinned as the WRONG answer this test exists to exclude.
    expect(ok.totalMonthlyCents).not.toBe(130_000)
  })

  it('handles every marked row ending — the remainder is exactly zero', () => {
    // ⚠️ RETITLED by code review 65.2. This used to claim it proved the
    // `Math.max(0, …)` floor; it did not and could not. With one marked row,
    // `total - marked` is exactly 0, so the floor and a bare subtraction are
    // indistinguishable — deleting `Math.max` left this green. The floor is now
    // unreachable by construction (negatives are refused), which the module says
    // at the call site; it is not tested, on purpose.
    const result = summarizeEndingExpenses([row({ amount: 180_000, endsBeforeRetirement: true })])
    expect(result).toMatchObject({
      state: 'ok',
      totalMonthlyCents: 180_000,
      markedMonthlyCents: 180_000,
      remainingMonthlyCents: 0,
    })
  })

  it('sums several marked rows across mixed cadences', () => {
    // biweekly 20_000c x 26/12 = 43_333.33… -> round = 43_333c (see the note above)
    const result = summarizeEndingExpenses([
      row({ amount: 180_000, endsBeforeRetirement: true }),
      row({ amount: 20_000, frequency: 'biweekly', endsBeforeRetirement: true }),
      row({ amount: 60_000 }),
    ])
    const ok = result as Extract<typeof result, { state: 'ok' }>
    expect(ok.state).toBe('ok')
    expect(ok.markedMonthlyCents).toBe(223_333)
    expect(ok.totalMonthlyCents).toBe(283_333)
    expect(ok.remainingMonthlyCents).toBe(60_000)
  })
})

describe('summarizeEndingExpenses — REFUSES rather than guessing', () => {
  it('⚠️⚠️ refuses a persisted STRING amount — the concatenation trap', () => {
    // `deferred-work.md:1001`: a string amount makes `+` a CONCATENATION and
    // yields a large, entirely plausible FINITE integer with no NaN to flag it.
    // A finiteness check alone would not catch this; `typeof === 'number'` does.
    expect(
      summarizeEndingExpenses([
        row({ amount: 180_000, endsBeforeRetirement: true }),
        row({ amount: '240000' }),
      ])
    ).toEqual({ state: 'unreadable' })
  })

  it('⚠️ and the string-amount row is the MARKED one', () => {
    expect(
      summarizeEndingExpenses([
        row({ amount: '180000', endsBeforeRetirement: true }),
        row({ amount: 240_000, endsBeforeRetirement: true }),
      ])
    ).toEqual({ state: 'unreadable' })
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('refuses a non-finite amount (%s)', (_label, amount) => {
    expect(
      summarizeEndingExpenses([
        row({ amount: 180_000, endsBeforeRetirement: true }),
        row({ amount }),
      ])
    ).toEqual({ state: 'unreadable' })
  })

  it('refuses an unrecognised frequency', () => {
    expect(
      summarizeEndingExpenses([
        row({ amount: 180_000, endsBeforeRetirement: true }),
        row({ frequency: 'fortnightly' }),
      ])
    ).toEqual({ state: 'unreadable' })
  })

  it('refuses a null or primitive array element without throwing', () => {
    // A truncated write or hand-edited storage can leave one of these in the
    // persisted array, and zustand only runs `migrate` on a version MISMATCH —
    // so a blob already at the current version carries it straight into state.
    expect(
      summarizeEndingExpenses([row({ amount: 180_000, endsBeforeRetirement: true }), null])
    ).toEqual({ state: 'unreadable' })
    expect(
      summarizeEndingExpenses([row({ amount: 180_000, endsBeforeRetirement: true }), 42])
    ).toEqual({ state: 'unreadable' })
  })

  it('⚠️ refuses a FRACTIONAL cent, which is finite and would show one number and adopt another', () => {
    expect(
      summarizeEndingExpenses([
        row({ amount: 180_000.5, endsBeforeRetirement: true }),
        row({ amount: 240_000 }),
      ])
    ).toEqual({ state: 'unreadable' })
  })

  it.each([
    ['an unmarked row', { amount: -100_000 }, { amount: 50_000, endsBeforeRetirement: true }],
    ['the marked row', { amount: -50_000, endsBeforeRetirement: true }, { amount: 100_000 }],
  ])('⚠️ refuses a NEGATIVE amount on %s (code review 65.2)', (_label, a, b) => {
    // `isReadableRow` checks `Number.isFinite` only, so a negative passes it.
    // Reachable from hand-edited localStorage AND from a pull — the server's
    // `expenseSchema.amount` is `z.number().int()` with no positivity bound and
    // the drizzle CHECK constraints never reached a real database. Unrefused, a
    // negative unmarked row rendered a NEGATIVE "your expenses today are …" and a
    // negative marked row made the remainder EXCEED the total.
    expect(summarizeEndingExpenses([row(a), row(b)])).toEqual({ state: 'unreadable' })
  })

  it('⚠️⚠️ refuses an amount that is safe MONTHLY but overflows when expressed ANNUALLY', () => {
    // THE CRASH found by code review 65.2. The consumer renders every figure
    // through the desired-income basis, which DEFAULTS to annual, so each is put
    // through `toAnnualIncomeCents` — which THROWS when the ×12 leaves the safe
    // range. Nothing catches it on the render path, so `/retirement` dropped to
    // its ErrorBoundary on every visit.
    //
    // ⚠️ FORM-REACHABLE, measured: the amount input has no `maxLength`, the
    // sanitizer caps no digits and `parseFromInput` has no bound, so typing
    // `8000000000000` saves exactly this value.
    const amount = 800_000_000_000_000
    expect(Number.isSafeInteger(amount)).toBe(true)
    expect(Number.isSafeInteger(amount * 12)).toBe(false)
    expect(summarizeEndingExpenses([row({ amount, endsBeforeRetirement: true })])).toEqual({
      state: 'unreadable',
    })
  })

  it('⚠️ PARITY: the refusal threshold is EXACTLY the renderer\u2019s throw threshold', () => {
    // The "an `ok` result is renderable in EITHER basis" invariant holds only if
    // this module's `Number.isSafeInteger(cents * 12)` matches the predicate that
    // `toAnnualIncomeCents` throws on. That logic is duplicated across two files
    // with no compiler link between them, so two drifting bounds would leave a
    // value `ok` here and crashing on the render path — the exact gap the second
    // review round flagged as unpinned.
    //
    // Largest monthly figure whose x12 is still a safe integer:
    //   9_007_199_254_740_991 / 12 = 750_599_937_895_082.58...
    const LARGEST_OK = 750_599_937_895_082
    expect(Number.isSafeInteger(LARGEST_OK * 12)).toBe(true)
    expect(Number.isSafeInteger((LARGEST_OK + 1) * 12)).toBe(false)

    expect(
      summarizeEndingExpenses([row({ amount: LARGEST_OK, endsBeforeRetirement: true })])
    ).toMatchObject({ state: 'ok' })
    expect(
      summarizeEndingExpenses([row({ amount: LARGEST_OK + 1, endsBeforeRetirement: true })])
    ).toEqual({ state: 'unreadable' })
  })
})
