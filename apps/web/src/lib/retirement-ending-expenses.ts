/**
 * The expenses a user has marked as ending before they retire (story 65.2, FR101).
 *
 * ## Why this is a pure module and not inline JSX
 *
 * Extracted so both branches — the figure and its refusal — are testable with
 * concrete numbers and without rendering anything, following the `get*Chrome()`
 * pattern established by story 24 (epic-24 record: "extract pure `get*()`
 * helpers and test both branches with CONCRETE floors").
 *
 * ## The boundary this module must not cross
 *
 * ⚠️⚠️ Everything here lands on the **desired income** side of the retirement
 * solve, and nothing here may reach the nest-egg base.
 * `RetirementAccumulationPlanner.tsx:334-350` carries an audited, load-bearing
 * decision that the base is assets-only, and `deferred-work.md:1000` records
 * that folding new rows into that base revives a compounding question with no
 * tripwire. The output of this module is a SUGGESTION for a field the user
 * authors; it is never an input to the solver.
 */

import { calculateTotalMonthlyNormalized } from '@budget-planner/core'
import { isReadableRow, toNormalizableItems } from './readable-rows'

/** The shape this module needs from a persisted expense row. */
export interface EndingExpenseRow {
  amount: number
  frequency: string
  endsBeforeRetirement?: boolean
}

export type EndingExpensesSummary =
  /** No row is marked. There is nothing to suggest, so the UI shows nothing. */
  | { state: 'none' }
  /**
   * At least one row could not be read, so no figure is offered at all.
   *
   * ⚠️ REFUSE rather than disclose-and-continue, which is the opposite of what
   * the Expenses page headline total does (`summarizeReadableRows`). The two are
   * different jobs: a headline total that vanishes is worse than one explaining
   * an exclusion, but this is an unsolicited SUGGESTION for the most
   * consequential number on the page. Refusing costs the user nothing; a
   * confidently wrong suggestion costs them a retirement date.
   * Precedent: `RetirementAccumulationPlanner.tsx:391-401`.
   */
  | { state: 'unreadable' }
  | {
      state: 'ok'
      /** Frequency-normalized monthly total of every scoped expense. */
      totalMonthlyCents: number
      /** Frequency-normalized monthly total of the MARKED expenses. */
      markedMonthlyCents: number
      /** What survives into retirement — the figure the adopt control offers. */
      remainingMonthlyCents: number
    }

/** A row the user has ticked. `=== true`, never truthy — see below. */
export function isMarked(row: EndingExpenseRow): boolean {
  // ⚠️ `=== true` is load-bearing twice over: rows persisted before 65.2 carry no
  // key at all (the client type is optional and no persist migration backfills
  // one), and localStorage is user-editable, so a persisted `"false"` STRING is
  // truthy. Mirrors how `contributionRecordedAsExpense` is read at
  // `BalancePage.tsx:373` and `SavingsPage.tsx:141`.
  return row.endsBeforeRetirement === true
}

/**
 * Summarize the marked expenses, or refuse.
 *
 * ⚠️ Normalizes through core rather than summing `amount`, so an annual
 * insurance premium and a weekly commute are not added as if both were monthly.
 *
 * ⚠️ MEASURED, and it contradicts the documentation: core multiplies by the
 * EXACT fractions `52/12`, `26/12` and `1/12`
 * (`packages/core/src/finance/normalization.ts:27-30`), not by the rounded
 * 4.333 / 2.167 / 0.083 that `project-context.md` and this story's epic both
 * quote. `normalizeToMonthly` then `Math.round`s each item individually. A test
 * that computes its expected figure from the rounded decimals is off by single
 * cents and looks like a real defect — do the arithmetic with the fractions.
 *
 * ⚠️⚠️ THE REUSE IS THE GUARD. `toNormalizableItems` filters on `isReadableRow`,
 * whose `typeof amount === 'number'` check is what stops a persisted STRING
 * amount turning `+` into a CONCATENATION — which yields a large, entirely
 * plausible finite integer with no `NaN` anywhere to flag it
 * (`deferred-work.md:1001`). A hand-written `rows.reduce((s, r) => s + r.amount,
 * 0)` here would reintroduce exactly that, and it is the obvious way to write
 * it. A finiteness check alone is NOT sufficient.
 */
export function summarizeEndingExpenses(rows: readonly unknown[]): EndingExpensesSummary {
  const marked = rows.filter(
    (row): row is EndingExpenseRow => isReadableRow(row) && isMarked(row as EndingExpenseRow)
  )
  const markedByPredicate = rows.filter(
    (row) =>
      typeof row === 'object' &&
      row !== null &&
      (row as EndingExpenseRow).endsBeforeRetirement === true
  )

  if (markedByPredicate.length === 0) {
    return { state: 'none' }
  }

  // ⚠️ Any unreadable row refuses the WHOLE summary, not just its own
  // contribution — including an unreadable row that is not marked. Both figures
  // are shown in one sentence ("your expenses today are X; you've marked Y"), so
  // an under-stated X would misrepresent the very comparison the sentence exists
  // to make. Silently dropping money out of a suggestion is the failure this
  // refusal exists to prevent.
  // ⚠️ `isReadableRow` is necessary but NOT sufficient here. It accepts any
  // FINITE number, which leaves two holes this check closes:
  //
  //   1. A FRACTIONAL cent (`180000.5`) passes it, and core's
  //      `normalizeToMonthly` then `Math.round`s each item — so the fraction
  //      disappears into a clean integer total and the figure would SHOW one
  //      number and ADOPT another, with nothing anywhere to flag it.
  //   2. A NEGATIVE amount passes it. Code review 65.2 found the comment that
  //      used to sit below claiming negatives were "unreachable today" because of
  //      the schema CHECK and the form's validation. That was FALSE, and it rested
  //      on THREE legs, of which story 66.5 removed exactly one:
  //        (a) localStorage is user-editable (which is the whole reason the flag
  //            is read `=== true`), and a row read from it NEVER PASSES THROUGH
  //            THE DATABASE AT ALL — no constraint can reach it. Still true.
  //        (b) the drizzle CHECK constraints had never reached a real database.
  //            ⚠️ NO LONGER TRUE — migration 0020 added
  //            `expenses_amount_positive`, so the server can no longer STORE a
  //            negative expense.
  //        (c) the server's own `expenseSchema.amount` is `z.number().int()` with
  //            no positivity bound. Still true.
  //      ⚠️⚠️ SO THE GUARD STAYS. Leg (a) alone is sufficient — the dominant path
  //      into this module is the local store, not a pull — and re-deriving
  //      "the database catches it now" from (b) would be the same error 65.2
  //      corrected, merely inverted. Unrefused, one negative unmarked row renders
  //      a NEGATIVE "your expenses today are …", and a negative MARKED row makes
  //      the remainder exceed the total.
  if (
    rows.some((row) => !isReadableRow(row) || !Number.isSafeInteger(row.amount) || row.amount < 0)
  ) {
    return { state: 'unreadable' }
  }

  const totalMonthlyCents = calculateTotalMonthlyNormalized(toNormalizableItems(rows))
  const markedMonthlyCents = calculateTotalMonthlyNormalized(toNormalizableItems(marked))

  // ⚠️⚠️ BOUND THE **ANNUAL** FORM, NOT THE MONTHLY ONE. This was a REAL CRASH
  // found by code review 65.2, and the monthly-only bound that used to be here is
  // what let it through.
  //
  // The consumer renders every one of these figures through the desired-income
  // field's basis, and that basis DEFAULTS to annual — so each is multiplied by
  // 12 by `toAnnualIncomeCents`, which THROWS when the product leaves the safe
  // range. That throw is on the render path and nothing catches it, so the whole
  // `/retirement` route drops to its ErrorBoundary on every visit until the row
  // is edited from another page.
  //
  // ⚠️ It is FORM-REACHABLE, not a tampering-only edge — measured, because the
  // review disagreed about this: the amount input has no `maxLength`, the
  // sanitizer caps no digits and `parseFromInput` has no bound, so typing
  // `8000000000000` saves 800_000_000_000_000 cents, which is itself a safe
  // integer while its ×12 is not.
  //
  // Bounding the annual form here means an `ok` result is renderable in EITHER
  // basis, which is the invariant the component actually needs. Refusing a
  // multi-trillion figure costs a user nothing real.
  const unsafe = (cents: number): boolean =>
    !Number.isSafeInteger(cents) || !Number.isSafeInteger(cents * 12)
  if (unsafe(totalMonthlyCents) || unsafe(markedMonthlyCents)) {
    return { state: 'unreadable' }
  }

  // ⚠️ DEFENSIVE AND UNREACHABLE BY CONSTRUCTION — deliberately kept, and
  // deliberately NOT given a test that would have to fake its way in.
  //
  // Every amount reaching here is now a non-negative safe integer (the refusal
  // above), and `marked` is a subset of `rows`, so `marked <= total` always and
  // the floor can never fire. The previous comment here claimed the floor was
  // guarding against a schema-CHECK-and-form-validation gap; that claim was false
  // and is corrected above. `expenseStore.ts`'s `sortByDisplayOrder` note records
  // the convention this follows: keep a cheap invariant, state that it is
  // unobservable, and do NOT manufacture a contrived test to make it fail.
  const remainingMonthlyCents = Math.max(0, totalMonthlyCents - markedMonthlyCents)

  return { state: 'ok', totalMonthlyCents, markedMonthlyCents, remainingMonthlyCents }
}
