// Imported from the barrel rather than the `finance` subpath: the subpath is
// unresolvable to `tsc` (no `exports` map; Vite/Vitest resolve it via alias), and
// every such import adds a TS2307 to the type-check baseline. The barrel
// re-exports `./finance/netIncome`, so this costs nothing. (Same reasoning as
// `lib/sanitized-input.ts`; the pre-existing subpath imports below are left as
// they were rather than churned.)
import { calculateNetIncomeResult, monthlyContributionCents } from '@budget-planner/core'
import {
  type IncomeBasis,
  type RetirementAccumulationResult,
  type RetirementModel,
  solveRetirementAccumulation,
  toMonthlyIncomeCents,
} from '@budget-planner/core/finance/retirement'
import {
  currencySymbol,
  formatCurrency,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import React, { useEffect, useMemo } from 'react'
import { parseAge, parseCurrencyToCents, parsePercentageToDecimal } from '../lib/retirement-parsers'
import { sanitizeMoneyChange } from '../lib/sanitized-input'
import { useBalanceEntries, useTotalInvestmentBalance } from '../stores/balanceStore'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { useExpenses } from '../stores/expenseStore'
import { useIncomeSources } from '../stores/incomeStore'
import {
  useMarkDesiredIncomeAuthored,
  useRetirementPlan,
  useSetAnnualReturnInput,
  useSetCurrentAgeInput,
  useSetDesiredIncomeForLocale,
  useSetDesiredIncomeInput,
  useSetIncomeBasis,
  useSetLifeExpectancyInput,
  useSetModel,
  useSetPostRetirementReturn,
} from '../stores/retirementPlannerStore'
import { ErrorBoundary } from './ErrorBoundary'
import RetirementTimelineChart from './RetirementTimelineChart'

/**
 * Share of current income used to seed a desired-retirement-income default.
 * A starting point the user is expected to edit, not a recommendation.
 *
 * ⚠️ DECIDED, NOT INHERITED (story 47.2, AC-16 — flagged here by story 46.1 and
 * recorded in `deferred-work.md`). The textbook 50%-replacement rule of thumb is
 * conventionally stated against GROSS pay, and since 46.1 the income rows are
 * explicitly take-home ("the amount that reaches your bank account"), so the same
 * 0.5 now targets a materially different retirement number than the convention it
 * resembles.
 *
 * It stays at 0.5 anyway, for two reasons. It seeds a field the user is expected
 * to edit and can see — this is a starting point, not an answer — and replacing
 * a familiar round number with a derived one would move every existing planner's
 * default on the strength of a heuristic this app has no evidence for. Read it as
 * "half of what currently reaches your bank account", which is what it computes.
 */
const DEFAULT_INCOME_REPLACEMENT_RATE = 0.5

/**
 * Longest horizon the growth chart will draw, mirroring core's own
 * `MAX_PROJECTION_YEARS` (which is module-private). A life expectancy far beyond
 * a human span must not turn into a thousand-point series.
 */
const MAX_PROJECTION_YEARS = 100

/** The parsed, ready-to-solve input set, or a reason it is not solvable yet. */
type ParsedInputs =
  | { ok: true; input: Parameters<typeof solveRetirementAccumulation>[0] }
  | { ok: false; reason: 'incomplete' | 'invalid' }

/**
 * A figure the planner DERIVES rather than collects (story 29.2, FR48/FR49).
 *
 * `cents` is always the floored, ready-to-use value — the display and the solver
 * read the same number, never two. The state exists because the user can no
 * longer correct these fields, so the "nothing useful here" cases must read
 * differently: telling someone whose portfolio nets below zero that they have
 * "no investment accounts" is simply false, and telling someone whose stored data
 * is corrupt that they have not set a contribution is worse — it is advice that
 * cannot help.
 *
 * ⚠️ Story 47.2 (FR74) added a case the old sources could not produce: investment
 * accounts that EXIST but carry no monthly contribution. That is `nonPositive`
 * with its own note, and it must never borrow the `empty` wording — the user has
 * already done the thing `empty` would tell them to do.
 */
type DerivedFigure = {
  state: 'ok' | 'empty' | 'nonPositive' | 'unreadable'
  /** The floored, ready-to-use value. Always a safe integer, never negative. */
  cents: number
  /**
   * True ONLY when the source was genuinely below zero and was clamped up.
   *
   * ⚠️ Deliberately separate from `state`. An exactly-zero source is also
   * `nonPositive`, but nothing was floored, so telling that user "your real
   * position is worse than these numbers suggest" would be a plain lie. Keying
   * the results caveat off the state name made exactly that mistake.
   */
  flooredFromNegative: boolean
  /** The explanatory line shown under the figure, or `null` when it needs none. */
  note: string | null
}

/**
 * Outcome of attempting the solve. `null` = not attempted (inputs incomplete or
 * invalid); `failed` = the solver threw (e.g. safe-integer overflow on an absurd
 * input); `solved` = a real result to render.
 */
type SolveState =
  | {
      status: 'solved'
      result: RetirementAccumulationResult
      input: Parameters<typeof solveRetirementAccumulation>[0]
    }
  | { status: 'failed'; detail: string | null }
  | null

/** Copy describing each model, shown next to the toggle and the results. */
const MODEL_COPY: Record<RetirementModel, { label: string; explanation: string }> = {
  deplete: {
    label: 'Deplete by life expectancy',
    explanation:
      'Draw your savings down to zero by your life expectancy — you spend both the returns and the principal over your retirement.',
  },
  perpetual: {
    label: 'Perpetual safe-withdrawal',
    explanation:
      'Live off the investment returns forever without touching the principal — your nest egg lasts indefinitely.',
  },
}

/**
 * Plain-language versions of the core calculation errors that can surface here.
 *
 * Carried forward from the retired `RetirementForm.sanitizeDisplayError` — this
 * is user-visible copy, so the merge re-homes it rather than dropping it. The six
 * original keys are all retained; three MORE were added in review, because the
 * throws this planner can actually produce were not among the original six:
 *
 * - `Required nest egg exceeds safe integer limit.` (`retirement.ts:539`) is the
 *   **deplete**-model overflow — the exact fat-finger case §7 documents and the
 *   test suite exercises with a 10-digit life expectancy. It was unmapped, so the
 *   detail line never rendered for the one case it was added to explain.
 * - `Projection overflow: nest egg exceeds safe integer limit…` (`retirement.ts:474`)
 *   comes from `projectAccumulatedNestEgg` inside the solver's search.
 * - The perpetual model reaches `Calculation overflow: Required assets…` via
 *   `calculateRequiredAssets`, so the same mistake now reads the same in both
 *   models rather than being explained in one and misdirected in the other.
 */
const SOLVER_ERROR_COPY: Record<string, string> = {
  'Annual return rate must be positive (greater than 0)':
    'Please enter a valid return rate (must be greater than 0%)',
  'Annual return rate must be positive (greater than 0). Safe Withdrawal Model requires positive return rate.':
    'Please enter a valid return rate (must be greater than 0%)',
  'Annual return rate must be at least 0.1% to avoid precision issues in calculations.':
    'Return rate must be at least 0.1% to ensure accurate calculations',
  // Story 35.3 — the two rate guards, named by phase so the two fields are
  // distinguishable. ⚠️ The accumulation entries below are NOT new copy for a new
  // throw: `'Annual return rate must be a non-negative finite number'` has been
  // thrown by `solveRetirementAccumulation` since 26.6 and was never a key here,
  // so it rendered no detail line at all. Adding the post-retirement pair without
  // its accumulation twin would have left that pre-existing hole open while
  // looking symmetrical. `rate-guard-copy.test.ts` pins all four.
  'Annual return rate must be a finite number':
    'Please enter a valid expected annual return (while saving)',
  'Annual return rate must be a non-negative finite number':
    'Please enter a valid expected annual return (while saving) — it cannot be negative',
  'Post-retirement return rate must be a finite number':
    'Please enter a valid post-retirement annual return',
  'Post-retirement return rate must be a non-negative finite number':
    'Please enter a valid post-retirement annual return — it cannot be negative',
  'Calculation overflow: Required assets exceeds safe integer limit. Try a smaller income or higher return rate.':
    'The calculated amount is too large. Please try smaller values.',
  'Calculation overflow: Required assets exceeds safe integer limit.':
    'The calculated amount is too large. Please try smaller values.',
  'Calculation overflow: Withdrawal amount exceeds safe integer limit.':
    'The calculated amount is too large. Please try smaller values.',
  'Number of years must not exceed 100 to prevent performance issues and calculation overflow.':
    'Please enter a projection period of 100 years or less',
  // ⚠️ Reworded for story 35.3. This throw used to need an absurd income to fire;
  // with two rates it also fires on a long life expectancy combined with a large
  // gap between them (measured: deplete 6%/3% at $60k income overflows from a life
  // expectancy of ~700, where the single-rate formula needed ~1.5e9). Blaming the
  // income field alone would misdirect the user at the input that is fine.
  'Required nest egg exceeds safe integer limit.':
    'These numbers are too large to plan for. Check your life expectancy, and the gap between your two return rates — a big gap over a very long retirement grows beyond what can be calculated.',
  'Projection overflow: nest egg exceeds safe integer limit. Try smaller values or fewer months.':
    'Your savings grow beyond what can be calculated. Please try smaller amounts.',
  // The derived figures now guard non-finite values before the solver sees
  // them, but these were previously unmapped, so a corrupt stored balance
  // surfaced as the generic "age or life expectancy looks out of range" —
  // pointing the user at a field that was not the problem, and since 29.2 is
  // not even editable. Kept as defence in depth.
  'Current saved amount must be a finite number':
    'We could not read your saved amount. Please check your investment accounts on the Balance Tracking page.',
  'Monthly savings must be a finite number':
    'We could not read your monthly savings. Please check the monthly contributions on your Balance Tracking page.',
  'Current age must be a finite number': 'Please enter a valid current age.',
  'Life expectancy must be a finite number': 'Please enter a valid life expectancy.',
  'Desired annual income must be a finite number':
    'Please enter a valid desired retirement income.',
}

/**
 * Maps a thrown core error to friendly copy, or `null` when it has no specific
 * translation (the caller already shows a general message, so an unmapped error
 * must not add noise).
 *
 * Exported for `rate-guard-copy.test.ts`, which drives the REAL core guards and
 * asserts each thrown message lands here. The mapping is keyed on exact core
 * strings, so a reworded guard silently stops rendering its detail line —
 * nothing type-checks it and, before that test, nothing covered it either.
 */
export function describeSolverError(error: unknown): string | null {
  return error instanceof Error ? SOLVER_ERROR_COPY[error.message] ?? null : null
}

/**
 * Re-expresses an entered desired-income amount as ANNUAL cents — the unit the
 * accumulation solver takes.
 *
 * The exact inverse of core's `toMonthlyIncomeCents`, which only converts the
 * other way (annual → monthly, for the monthly-only Safe Withdrawal Model). The
 * round-trip is lossless for a monthly entry, since `× 12` then `round(÷ 12)`
 * returns the original cents.
 *
 * Re-checks the safe-integer bound after multiplying: `parseCurrencyToCents`
 * guards the ENTERED figure, but `× 12` happens after that guard, so a monthly
 * entry just inside the limit could otherwise hand the solver a value outside it
 * — breaking this component's stated "strictly parsed and guarded before the
 * solver is ever called" contract. Throwing here routes it to the same
 * invalid-input state as any other malformed entry.
 *
 * @throws Error if the converted annual amount exceeds the safe-integer range.
 */
function toAnnualIncomeCents(amountCents: number, basis: IncomeBasis): number {
  if (basis === 'annual') {
    return amountCents
  }

  const annualCents = amountCents * 12

  if (!Number.isSafeInteger(annualCents)) {
    throw new Error('Invalid currency: value exceeds safe integer limit')
  }

  return annualCents
}

/**
 * How many years of accumulation the growth chart should draw.
 *
 * ⚠️ **Stops at retirement when retirement is reachable.** The story mandated a
 * horizon of `lifeExpectancy − currentAge`, and that is still the fallback — but
 * taken literally it made the chart keep contributing, and never withdrawing, for
 * every year past the retirement age the same page had just computed. Under the
 * `deplete` model that is a flat contradiction: the plan says the nest egg is
 * drawn to ZERO by life expectancy, while the curve showed it peaking there, with
 * a headline figure an order of magnitude larger than the plan's own. Two big
 * money numbers from one input set meaning opposite things is precisely what this
 * story exists to remove, so the curve now ends where the accumulation does.
 *
 * Life expectancy remains the horizon when retirement is NOT reachable — there is
 * no retirement age to stop at, and the full window is the useful thing to show.
 *
 * Floored at 1 year so an immediately-reachable plan still renders a curve rather
 * than collapsing to the empty state, and capped at `MAX_PROJECTION_YEARS`.
 */
function chartHorizonYears(
  input: Parameters<typeof solveRetirementAccumulation>[0],
  result: RetirementAccumulationResult
): number {
  const yearsToRetirement =
    result.reachable && result.earliestRetirementAge !== null
      ? Math.ceil(result.earliestRetirementAge - input.currentAge)
      : null

  const horizon =
    yearsToRetirement === null
      ? Math.max(0, input.lifeExpectancy - input.currentAge)
      : Math.max(1, yearsToRetirement)

  return Math.min(MAX_PROJECTION_YEARS, horizon)
}

/**
 * RetirementAccumulationPlanner
 *
 * The whole `/retirement` planner: two derived figures, one shared input set, one
 * solve, one set of outputs, and the growth chart that visualises them
 * (stories 26.7 / 29.1 / 29.2).
 *
 * ## What 29.2 derived
 *
 * "Current amount saved" and "monthly savings" are no longer asked for — the app
 * already holds both, so it computes them instead. ⚠️ Since story 47.2 (FR74)
 * BOTH come from the investment rows on the Balance Tracking page: the accounts'
 * balance total, and the frequency-normalized total of their monthly
 * contributions. Income and expenses no longer reach this component's figures at
 * all — they survive only as the seed for the desired-income prefill. Four
 * editable fields remain.
 *
 * Because the user can no longer correct either figure, two things follow that
 * would otherwise be optional. Both are floored at zero AT THE BINDING BOUNDARY,
 * so the number on screen is the number the solver and the chart receive; and a
 * figure that floored from a NEGATIVE source says so, rather than passing itself
 * off as a neutral zero.
 *
 * ## What 29.1 consolidated
 *
 * The page used to be three tools that each collected their own copy of the same
 * facts — expected annual return was asked for THREE times, current savings and
 * current age twice each — and then disagreed with one another, which the page
 * copy excused with two "these inputs are independent" warnings. Each shared
 * input is now collected exactly once here and drives every output:
 *
 * - the required nest egg (the perpetual model IS the Safe Withdrawal Model —
 *   `desiredAnnualIncome / rate` is the same figure the standalone SWM form used
 *   to compute separately, story 26-7:125), and
 * - the timeline chart, which now samples the solver's own monthly-compounded
 *   accumulation function rather than an annually-compounded one.
 *
 * The solver throws on non-finite/negative inputs, so inputs are strictly parsed
 * and guarded before it is ever called; a `reachable: false` result (no feasible
 * retirement before life expectancy) is rendered as a calm, actionable state
 * rather than an error.
 */
function RetirementAccumulationPlannerInner() {
  const { mode, currency, locale } = useCurrencyPreferences()
  // ⚠️ AUDITED for story 32.2 (FR59) and deliberately UNCHANGED: this is the
  // NEST-EGG BASE, not net worth. It must stay assets-only — netting a mortgage
  // off the pot you retire on is not the same question. Whether goal-less savings
  // ACCOUNTS should feed this total is a separate, already-recorded decision
  // (deferred-work.md, "Savings-page balances cannot reach the retirement
  // planner"), not something FR59 settles.
  // ⚠️ Story 43.4 (D6), and this decision is LOAD-BEARING, not incidental.
  // `RetirementTimelineChart` compounds this figure through
  // `projectAccumulatedNestEgg` at the investment return rate, which makes this
  // the ONLY surviving projection in the app fed by balance entries. Assets
  // (FR70) are deliberately EXCLUDED from it.
  // The reason is CONSISTENCY, not "a condo is not retirement savings": cash held
  // in savings accounts is already excluded (see the note above), so excluding
  // cash-recorded-as-an-asset is uniform treatment rather than a new carve-out.
  // ⚠️ `deferred-work.md`'s "should a non-appreciating asset compound at the
  // investment return rate?" is therefore CONTINGENTLY closed, not dissolved: it
  // revives the moment any story folds asset rows into this total.
  const totalInvestmentCents = useTotalInvestmentBalance()
  const balanceEntries = useBalanceEntries()
  const incomeSources = useIncomeSources()
  const expenses = useExpenses()

  // ── The two derived figures (story 29.2, FR48 + FR49) ──────────────────────
  //
  // These replace what used to be two editable money inputs. Both are floored at
  // zero HERE, at the binding boundary, and only the floored value travels on to
  // the solver and the chart.
  //
  // ⚠️ Flooring here rather than downstream is about keeping the DISPLAY honest.
  // Core is already defended — `solveRetirementAccumulation` clamps
  // `savedPerYearCents` (`retirement.ts:636`) and `projectAccumulatedNestEgg`
  // clamps BOTH of its own inputs on arrival (`:449-450`), which are the only two
  // consumers — so an unclamped negative could never have eroded the projection.
  // (The epic's clamp note generalised from 28.2's real erosion bug in
  // `createNetWorthProjection`, a different function.) What flooring prevents is
  // the card reading "−$2,000.00" beside solver figures computed from zero: one
  // input, two contradictory numbers, and no field left for the user to correct.

  // Value comes from the shared selector (the same figure as the 26.5 "Total
  // Investments" card — one source of truth); the entry list is read only to tell
  // "no accounts yet" apart from "accounts that add up to nothing".
  const derivedCurrentSaved = useMemo<DerivedFigure>(() => {
    if (!balanceEntries.some((entry) => entry.type === 'investment')) {
      return {
        state: 'empty',
        cents: 0,
        flooredFromNegative: false,
        // Story 43.4 (D6): name the RULE, not the absence. A user who holds only
        // assets DOES have Balance Tracking entries, so the old copy ("Add
        // investment accounts on the Balance Tracking page") sent them to a page
        // they had already filled in.
        note: 'Only investment accounts count toward your nest egg — add them on the Balance Tracking page.',
      }
    }
    // ⚠️ The sync applier writes pulled rows straight into the store without
    // `validateBalanceTracking` (`lib/sync/applyServerChanges.ts:93-94`), so this
    // total can be NaN, Infinity or fractional. Left unguarded, `formatCurrency`
    // renders NaN as a confident "0.00" while the solver throws — and a fractional
    // cent shows one number and solves another. The free Net Worth projection
    // page refused the identical data and set this precedent; story 43.3 removed
    // that page, so this guard now stands on its own rather than by analogy.
    if (!Number.isSafeInteger(totalInvestmentCents)) {
      return {
        state: 'unreadable',
        cents: 0,
        flooredFromNegative: false,
        note: "We couldn't read your investment account balances.",
      }
    }
    if (totalInvestmentCents < 0) {
      return {
        state: 'nonPositive',
        cents: 0,
        flooredFromNegative: true,
        note: 'Your investment accounts currently net below zero, so this plan assumes nothing saved yet.',
      }
    }
    if (totalInvestmentCents === 0) {
      // Accounts exist but hold nothing. Not floored, so no "worse than shown"
      // caveat — but it still must not read like the empty state.
      return {
        state: 'nonPositive',
        cents: 0,
        flooredFromNegative: false,
        note: 'Your investment accounts currently hold nothing.',
      }
    }
    return { state: 'ok', cents: totalInvestmentCents, flooredFromNegative: false, note: null }
  }, [balanceEntries, totalInvestmentCents])

  // Frequency-NORMALIZED total of what the user puts INTO their investment
  // accounts each month (story 47.2, FR74 — which amends FR49).
  //
  // ⚠️ The source changed here, and the change is the whole point of the story.
  // This used to be `calculateNetIncomeResult(...).netIncome` — income minus
  // expenses — which answers "what is left over", a different question from
  // "what am I actually saving". Both derived figures on this page now read the
  // SAME investment rows: "Current Amount Saved" is what those accounts hold,
  // "Monthly Savings" is what goes into them. That coherence is what this change
  // buys, and it is why the copy below never mentions income or expenses again.
  //
  // ⚠️⚠️ A contribution the user has ticked as already accounted for
  // (`contributionRecordedAsExpense`) COUNTS IN FULL here. Getting this backwards
  // is the subtle failure this story exists to avoid. The tick is a statement
  // about the SAVINGS POOL only — it stops `calculateDistributablePool`
  // subtracting the same money twice (stories 45.1/47.1, FR72) — and says nothing
  // about whether the money is invested. It is: the user is genuinely putting it
  // into the account. So never filter on that flag here, and never reuse
  // `savingsAllocation`'s `sumMonthlyInvestmentContributions`, which does filter
  // on it and would silently import the pool's rule into the retirement plan.
  //
  // ⚠️ `monthlyContributionCents` is the repo's SINGLE normalizer for this field
  // (`services/balanceTracking.ts:203-223`, which says so in its own docstring
  // and requires every projection consumer to route through it). It coerces an
  // unrecognised cadence to 'monthly' — the same degradation `SavingsPage`'s
  // `KNOWN_FREQUENCIES` applies, so the pool and this figure can never disagree
  // about a corrupt CADENCE — and throws on a non-finite amount, which is what
  // reaches the catch below.
  //
  // ⚠️ Narrowed to CADENCE deliberately. The two surfaces do NOT degrade alike on
  // a corrupt AMOUNT: this figure catches the throw and reads `unreadable`, while
  // `SavingsPage`'s breakdown memo has no catch and takes /savings to its
  // ErrorBoundary on the identical row. That asymmetry is pre-existing and out of
  // this story's scope — but the invariant claimed here is only the cadence half,
  // and stating the broader one would be false.
  const derivedMonthlySavings = useMemo<DerivedFigure>(() => {
    // ⚠️ `entry != null` guards the repo's documented persisted-array hazard
    // (`lib/readable-rows.ts` records the whole case): the array can hold a `null`
    // or primitive element from a truncated write or hand-edited storage, and
    // zustand only runs `migrate` on a version MISMATCH, so a blob already at the
    // current version carries the bad element straight into state. Reading `.type`
    // off it throws OUTSIDE the try/catch below.
    //
    // ⚠️⚠️ HONESTLY: THIS IS UNREACHABLE TODAY, and no test can cover it —
    // measured, deleting it leaves the suite green. `useTotalInvestmentBalance`
    // (`balanceStore.ts:356-361`) reads `e.type` off the same array at `:328`,
    // several lines earlier in this component, and throws first on the identical
    // element. It is insurance against that call moving or going away, not a live
    // guard, and it is recorded as such rather than left to look load-bearing.
    const investments = balanceEntries.filter(
      (entry) => entry != null && entry.type === 'investment'
    )

    // No investment accounts at all. The same condition `derivedCurrentSaved`
    // uses, now that both figures read one source — but the advice differs,
    // because an account with no contribution set still leaves this figure at
    // zero, and that user needs to be told something else.
    if (investments.length === 0) {
      return {
        state: 'empty',
        cents: 0,
        flooredFromNegative: false,
        note: 'Add an investment account on the Balance Tracking page, and say what you put in each month.',
      }
    }

    let total = 0
    // ⚠️ Counted rather than inferred afterwards: the per-row clamp erases the
    // evidence, so a negative row is unrecoverable from the total once summed.
    //
    // ⚠️⚠️ This is NOT the same thing as `flooredFromNegative`, and conflating
    // the two was a real defect caught in review. That flag is a property of the
    // FIGURE — its docblock says so: "the SOURCE was genuinely below zero and was
    // clamped up" — and it drives a results caveat whose copy says the projection
    // "treats it as zero". A negative row alongside a larger positive one floors
    // nothing: the figure is positive, the solver uses it, and firing that caveat
    // would state two falsehoods in one sentence. The row-level fact is disclosed
    // on the card instead, where it is local and true.
    let negativeRows = 0
    try {
      for (const entry of investments) {
        const monthly = monthlyContributionCents(entry)
        if (monthly < 0) {
          negativeRows += 1
        }
        // ⚠️ Clamped PER ROW, then summed — the pool's exact discipline
        // (`savingsAllocation.ts:116-124`). `monthlyContributionCents` rounds per
        // item, so summing already-rounded values keeps this figure and the
        // savings pool in step to the cent. Clamping the TOTAL instead would let
        // one negative row eat a real contribution from another.
        total += Math.max(0, monthly)
      }
    } catch {
      // `validateAmount` throws on a non-finite `monthlyContribution`, which is
      // reachable: the sync applier writes pulled rows straight into the store
      // without validating them. Unguarded, that takes the whole planner to the
      // ErrorBoundary.
      return {
        state: 'unreadable',
        cents: 0,
        flooredFromNegative: false,
        note: "We couldn't read your investment account contributions.",
      }
    }

    // Past the safe-integer range: the card would show one number while the
    // solver worked from another.
    //
    // ⚠️ Only OVERFLOW reaches this, not a fractional total — `monthlyContributionCents`
    // rounds per row, so every summand is already an integer. An earlier version
    // of this comment also claimed "not a whole number of cents", describing a
    // state the loop above makes unreachable.
    if (!Number.isSafeInteger(total)) {
      return {
        state: 'unreadable',
        cents: 0,
        flooredFromNegative: false,
        note: "We couldn't read your investment account contributions.",
      }
    }

    // ⚠️⚠️ TWO DIFFERENT ZEROS, and collapsing them was a defect caught in
    // review. Both render 0.00, and the advice for one is false for the other:
    // telling someone whose contribution was clamped up from below zero to "add
    // one" tells them to do the thing they have already done — while the results
    // caveat beside it simultaneously says a figure came out below zero. Two
    // contradictory sentences on one screen. `derivedCurrentSaved` above has
    // always drawn this same distinction ("net below zero" vs "hold nothing");
    // this figure now does too.
    if (total === 0) {
      if (negativeRows > 0) {
        return {
          state: 'nonPositive',
          cents: 0,
          flooredFromNegative: true,
          note: 'Your investment account contributions currently come to less than nothing, so this plan assumes nothing saved each month.',
        }
      }
      // Accounts exist, but nothing is going into them. ⚠️ A state the OLD source
      // could not produce, and the main user-visible risk in this change: left
      // unexplained, the plan silently reports that this user can never retire.
      return {
        state: 'nonPositive',
        cents: 0,
        flooredFromNegative: false,
        note: 'Your investment accounts have no monthly contribution set yet — add one on the Balance Tracking page.',
      }
    }

    // A positive total that nonetheless hid a clamped row. The figure itself was
    // never floored, so `flooredFromNegative` stays false (see the note above the
    // counter) — but the total DOES overstate the honest sum, and saying so on
    // the card is both true and local.
    return {
      state: 'ok',
      cents: total,
      flooredFromNegative: false,
      note:
        negativeRows > 0
          ? 'One or more accounts have a negative monthly contribution, which this plan counts as nothing.'
          : null,
    }
  }, [balanceEntries])

  // AC-4: a figure floored from a NEGATIVE source, or one we could not read at
  // all, must never be presented as a neutral zero — the results carry the caveat
  // alongside the numbers it qualifies. An exactly-zero source is excluded: it is
  // honestly zero and nothing was reduced.
  const flooredFromNegative =
    derivedCurrentSaved.flooredFromNegative || derivedMonthlySavings.flooredFromNegative
  const derivedUnreadable =
    derivedCurrentSaved.state === 'unreadable' || derivedMonthlySavings.state === 'unreadable'
  // Genuinely no source data at all — distinct from "sources exist but total zero".
  //
  // ⚠️ Deliberately ONE condition since story 47.2, not the two-sided `&&` it was.
  // Both figures now derive from the same investment rows, so `derivedCurrentSaved`
  // and `derivedMonthlySavings` reach `empty` on exactly the same input and the
  // second test could never fail independently. Keeping the `&&` would have implied
  // two sources are being checked when only one exists — the kind of true-by-
  // construction guard this repo has been bitten by before.
  const noSourceData = derivedCurrentSaved.state === 'empty'

  // Pre-fill a desired-income target: a share of current income, as an ANNUAL
  // figure (the field's canonical basis).
  //
  // Sourced from the frequency-NORMALIZED gross income, not the raw cents sum the
  // retired form used. That sum counted a weekly $500 as $500/month, so seeding
  // from it would propagate a known distortion into everyone's default.
  //
  // Held as ANNUAL CENTS, deliberately not as a display string: the string form
  // depends on the selected basis, and baking the basis in here would make the
  // re-seed effect below fire on every basis switch — rewriting a number the user
  // typed. Conversion happens at the moment of seeding instead.
  //
  // Wrapped because this is the only core call on the render path that is not
  // already inside a try/catch: `calculateNetIncomeResult` throws on a
  // non-finite amount or an unrecognised frequency, and a corrupt persisted
  // income/expense row would take the entire planner to the ErrorBoundary. Every
  // other seed path here degrades to "no prefill"; this one now matches.
  const prefillDesiredIncomeCents = useMemo<number | null>(() => {
    try {
      const { grossIncome } = calculateNetIncomeResult(
        incomeSources.map((s) => ({ amount: s.amount, frequency: s.frequency })),
        expenses.map((e) => ({ amount: e.amount, frequency: e.frequency }))
      )
      if (grossIncome <= 0) {
        return null
      }
      return Math.round(grossIncome * 12 * DEFAULT_INCOME_REPLACEMENT_RATE)
    } catch {
      return null
    }
  }, [incomeSources, expenses])

  // ── The plan (story 44.1, FR71) ──────────────────────────────────────────
  // Held in a PERSISTED store rather than component state. `/retirement`
  // unmounts on every route change, so `useState` lost the whole plan on a nav
  // as well as on a reload. Everything below is still the raw input STRING,
  // exactly as typed — the parse gates further down need to tell "not filled in"
  // from "entered zero", and that distinction only survives if `''` does.
  //
  // The two derived figures above are deliberately NOT in the store: they track
  // the Balance/Income/Expenses stores on purpose (FR48/FR49), and persisting
  // them would restore the savings you had when you saved the plan.
  const {
    currentAgeInput,
    lifeExpectancyInput,
    desiredIncomeInput,
    desiredIncomeTouched,
    desiredIncomeLocale,
    incomeBasis,
    annualReturnInput,
    postRetirementReturnInput,
    postRetirementTouched,
    model,
  } = useRetirementPlan()
  const setCurrentAgeInput = useSetCurrentAgeInput()
  const setLifeExpectancyInput = useSetLifeExpectancyInput()
  const setDesiredIncomeInput = useSetDesiredIncomeInput()
  const markDesiredIncomeAuthored = useMarkDesiredIncomeAuthored()
  const setDesiredIncomeForLocale = useSetDesiredIncomeForLocale()
  const setIncomeBasis = useSetIncomeBasis()
  const setAnnualReturnInput = useSetAnnualReturnInput()
  const setPostRetirementReturn = useSetPostRetirementReturn()
  const setModel = useSetModel()

  // The post-retirement rate MIRRORS the accumulation rate until the user edits
  // it, after which it is independent. That is what makes an untouched planner
  // numerically identical to its pre-35.3 behaviour at EVERY rate, not just at
  // the 6.0 default — a user who sets accumulation to 8% and never touches this
  // field still gets a single-rate 8% plan, exactly as before.
  //
  // ⚠️ The stored value starts EMPTY, not '6.0': a literal would end the mirror
  // on the very first render. Everything downstream reads the derived
  // `effectivePostRetirementReturnInput`, never the raw state. Since 44.1 that
  // default lives in `RETIREMENT_PLAN_DEFAULTS`, and `coerceRetirementPlan`
  // re-establishes the empty-while-untouched pairing on every rehydrate so a
  // restored plan can never carry an invisible stale rate.
  const effectivePostRetirementReturnInput = postRetirementTouched
    ? postRetirementReturnInput
    : annualReturnInput

  // The desired-income seed, which unlike the two derived figures above is still
  // a real editable field — with one extra hazard.
  //
  // ⚠️ The seed is an ANNUAL figure, but the field is read under whichever basis
  // the user has selected. Writing the annual number into a field the user has
  // switched to Monthly means the solver reads it as 12× the intended income —
  // a silent, unflagged overstatement of the required nest egg. So the value is
  // converted to the CURRENT basis as it is written.
  //
  // ⚠️ The basis USED to be read through a ref, so that switching monthly/annual
  // left a typed number exactly as entered and changed only its meaning. Story
  // 44.1 replaced the ref with a real dependency, because `desiredIncomeTouched`
  // now provides that protection directly and more precisely: a value the user
  // authored is guarded by the early return below, so the only value a basis
  // switch can rewrite is one the app seeded itself.
  //
  // Keeping the ref once the plan persists would have been a correctness bug, not
  // a style choice — see the effect's comment.

  // ⚠️ THE SEEDED VALUE MUST FOLLOW THE BASIS, OR THE PLAN DOES NOT ROUND-TRIP
  // (story 44.1 code review). Reachable sequence, measured: an income-seeded user
  // sees 12,000.00 under Annual, flips the select to Monthly, and the field still
  // reads 12,000.00 — now solved as a MONTHLY income, i.e. 12x the intended plan.
  // That trio (`untouched` + `monthly` + an annual figure) then persists, and on
  // the next load this effect re-fires and re-seeds to 1,000.00. The projection
  // the user left is not the projection they come back to.
  //
  // Before persistence the state evaporated at unmount; persisting it is what
  // made it observable, so this story owns it. `incomeBasis` is therefore a real
  // dependency: while the value is UNTOUCHED the seed follows the basis, so what
  // is on screen and what reloads are the same number. A value the user authored
  // is untouched by this — the early return below covers it.
  //
  // ⚠️⚠️ `desiredIncomeTouched` IS THE PERSISTENCE GUARD, AND IT IS LOAD-BEARING
  // (story 44.1). `prefillDesiredIncomeCents` derives from the INCOME store,
  // which rehydrates in the same `StoreHydration` pass as the plan — so on every
  // visit the prefill goes null -> real, this effect fires, and without the flag
  // it overwrites the number the user saved. Silent, and only for users who have
  // income rows: every other restored field still checks out, so the plan looks
  // like it persisted while this one field quietly resets. `deferred-work.md:643`
  // records the identical shape on the sibling `RetirementForm`.
  //
  // Seeding is therefore a courtesy for a field the user has never authored, and
  // it stops the moment they do. It is not a "keep this in sync with income"
  // behaviour and never was — the seed is a starting point, not a derivation.
  useEffect(() => {
    if (prefillDesiredIncomeCents === null || desiredIncomeTouched) {
      return
    }
    const seededCents =
      incomeBasis === 'annual'
        ? prefillDesiredIncomeCents
        : Math.round(prefillDesiredIncomeCents / 12)
    const next = formatForInputDisplay(seededCents, locale)
    setDesiredIncomeForLocale(next, locale)
  }, [
    prefillDesiredIncomeCents,
    locale,
    incomeBasis,
    desiredIncomeTouched,
    setDesiredIncomeForLocale,
  ])

  // ⚠️ A PERSISTED MONEY STRING MUST BE RE-EXPRESSED WHEN THE LOCALE CHANGES, OR
  // THE PLAN'S CENTRAL FIGURE SILENTLY RESCALES (story 44.1 code review).
  //
  // This field persists a DISPLAY string, unlike every other store in the app,
  // which persists integer cents. The string's meaning depends on the locale it
  // was written under, and the locale follows the user's currency choice — which
  // is two clicks away in Settings. MEASURED against the real parser:
  //
  //   '55.000,00'  authored de-DE, reparsed en-US -> 5500 cents   ($55, not €55,000)
  //   '1234,56'    authored de-DE, reparsed en-US -> 12345600      ($123,456)
  //
  // No throw, no invalid state: the field goes on showing the old string while
  // the solver confidently answers a different question. Only an AUTHORED value
  // is at risk — an untouched seed is rewritten by the effect above, which has
  // `locale` in its deps — so this targets exactly the number the user chose.
  //
  // Re-express rather than reformat blindly: parse under the locale the string
  // was WRITTEN in, then format under the current one, so the magnitude is
  // carried across rather than reinterpreted.
  useEffect(() => {
    if (!desiredIncomeTouched || desiredIncomeLocale === '' || desiredIncomeLocale === locale) {
      return
    }
    let next: string
    try {
      next = formatForInputDisplay(
        parseCurrencyToCents(desiredIncomeInput, desiredIncomeLocale),
        locale
      )
    } catch {
      // A partial or malformed entry ('1,2', '') has no magnitude to carry. Leave
      // the characters exactly as the user left them and just adopt the new
      // locale, so this does not retry on every render.
      setDesiredIncomeForLocale(desiredIncomeInput, locale)
      return
    }
    setDesiredIncomeForLocale(next, locale)
  }, [
    locale,
    desiredIncomeLocale,
    desiredIncomeTouched,
    desiredIncomeInput,
    setDesiredIncomeForLocale,
  ])

  // Re-echo a currency field in grouped, locale-aware form on blur. Uses the
  // non-throwing core parser so it can never throw inside the state updater. Both
  // guard arms are load-bearing and must stay: the empty arm keeps "not filled in"
  // from becoming "entered zero" (which would defeat the `anyMoneyEmpty`
  // incomplete-state below), and the no-digit arm keeps the digit-free partials
  // sanitizeMoneyInput deliberately allows through (story 28-1) VISIBLE — without
  // it a half-typed "-" would silently become "0.00".
  const reEcho = (setter: React.Dispatch<React.SetStateAction<string>>) => () => {
    setter((prev) =>
      prev.trim() === '' || !/\d/.test(prev)
        ? prev
        : formatForInputDisplay(parseFromInput(prev, locale), locale)
    )
  }

  // Parse every field once. Empty required fields → 'incomplete' (show guidance,
  // don't solve); a malformed field → 'invalid' (show validation note). Never
  // calls the solver with garbage, so the solver's uniform throw stays internal.
  const parsed = useMemo<ParsedInputs>(() => {
    try {
      const currentAge = parseAge(currentAgeInput)
      const lifeExpectancy = parseAge(lifeExpectancyInput)
      // Only desired income is still a money INPUT — the other two figures are
      // derived and always present, so they can never be "not filled in".
      const anyMoneyEmpty = desiredIncomeInput.trim() === ''
      // ⚠️ Tests the EFFECTIVE post-retirement value, not the raw state — while
      // the field is mirroring, the raw state is '' and testing it would leave an
      // untouched planner permanently "incomplete". And the check itself is
      // load-bearing: `parsePercentageToDecimal` returns 0 for an empty string
      // rather than throwing, so a cleared field would otherwise silently become
      // a 0% assumption and render a confident, badly wrong answer.
      const anyRateEmpty =
        annualReturnInput.trim() === '' || effectivePostRetirementReturnInput.trim() === ''

      if (currentAge === null || lifeExpectancy === null || anyMoneyEmpty || anyRateEmpty) {
        return { ok: false, reason: 'incomplete' }
      }

      return {
        ok: true,
        input: {
          currentAge,
          // Already floored at the binding boundary above — the solver and the
          // chart receive exactly what the display shows.
          currentSavedCents: derivedCurrentSaved.cents,
          monthlySavingsCents: derivedMonthlySavings.cents,
          annualReturnRate: parsePercentageToDecimal(annualReturnInput),
          postRetirementReturnRate: parsePercentageToDecimal(effectivePostRetirementReturnInput),
          desiredAnnualIncomeCents: toAnnualIncomeCents(
            parseCurrencyToCents(desiredIncomeInput, locale),
            incomeBasis
          ),
          lifeExpectancy,
          model,
        },
      }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }, [
    currentAgeInput,
    lifeExpectancyInput,
    derivedCurrentSaved.cents,
    derivedMonthlySavings.cents,
    desiredIncomeInput,
    incomeBasis,
    annualReturnInput,
    // The DERIVED value, not the two raw states behind it: `useExhaustiveDependencies`
    // is an error-level rule and would flag those as unused here. The derived
    // value is a pure function of both, so the memo still recomputes correctly.
    effectivePostRetirementReturnInput,
    model,
    locale,
  ])

  // Run the solver on valid inputs only. Bundles the solved input alongside the
  // result so the render can read `input.currentSavedCents` without re-narrowing
  // the `parsed` union. A discriminated status keeps the three outcomes distinct:
  // `null` = not attempted (inputs incomplete/invalid — the guidance panel shows);
  // `failed` = the solver threw (e.g. a safe-integer overflow on an absurdly large
  // life expectancy) → we surface an explicit "value too large" message instead of
  // rendering nothing; `solved` = a real result (reachable or not-reachable). The
  // try/catch also keeps any throw off the ErrorBoundary.
  const solved = useMemo<SolveState>(() => {
    if (!parsed.ok) {
      return null
    }
    try {
      return {
        status: 'solved',
        result: solveRetirementAccumulation(parsed.input),
        input: parsed.input,
      }
    } catch (e) {
      return { status: 'failed', detail: describeSolverError(e) }
    }
  }, [parsed])

  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency, locale })

  // One focus + tap-target convention for every control on the page (the chart's
  // old controls used `focus:outline-none focus:ring-2`, the planner's used
  // `focus:ring-2` alone, and only the chart's met the 44px target).
  const controlChrome =
    'min-h-[44px] border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors'

  const inputClass = (withSymbol: boolean) =>
    `w-full py-3 ${mode === 'symbol' && withSymbol ? 'pl-10 pr-4' : 'px-4'} ${controlChrome}`

  // A currency text input with the shared symbol-prefix + grouped-echo behavior.
  // ⚠️ A plain render helper (CALLED, not mounted as a `<Component/>`) so the
  // input keeps a stable identity across renders and never loses focus mid-typing.
  // Defining this as a component in the render body remounts the input on every
  // keystroke — the story 26.7 regression, pinned by a focus-retention test.
  // Since 29.2 it serves a single field (desired retirement income), which makes
  // inlining it tempting — don't: inlining is exactly what reintroduces the bug.
  //
  // The money field stays `type="text" inputMode="decimal"`: `setSelectionRange`
  // throws on `type="number"`, which would silently disable the caret correction
  // in `sanitizeMoneyChange` and make the grouped blur echo unassignable.
  const currencyField = ({
    id,
    label,
    help,
    value,
    onChange,
    onUserEdit,
    children,
  }: {
    id: string
    label: string
    help: string
    value: string
    onChange: React.Dispatch<React.SetStateAction<string>>
    /**
     * Fired when the USER types, and deliberately not on blur (story 44.1).
     * Blur runs `reEcho` on its own, and a tab-through with no keystroke must not
     * count as authoring the value — that would freeze the income prefill for
     * someone who only moved focus past the field.
     */
    onUserEdit?: () => void
    children?: React.ReactNode
  }) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-label mb-2">
        {label}
      </label>
      <div className="relative">
        {mode === 'symbol' && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
            {currencySymbol(currency)}
          </span>
        )}
        <input
          type="text"
          id={id}
          name={id}
          value={value}
          onChange={(e) => {
            // ⚠️ Latch AFTER sanitizing, and only if the value actually MOVED
            // from what was on screen (story 44.1 code review). Latching first
            // meant one rejected keystroke — a letter in a money field — silently
            // and permanently ended the income seed for that user, across every
            // future session, without changing a character on screen.
            //
            // ⚠️ Compare against `value`, the CURRENT state, not against
            // `e.target.value`: the latter is the post-keystroke raw input, so a
            // normal accepted keystroke leaves the two equal and the comparison
            // inverts — the latch would then fire on exactly the rejected
            // keystrokes it exists to ignore. (Caught in review of this fix.)
            const sanitized = sanitizeMoneyChange(e.target, locale)
            if (sanitized !== value) {
              onUserEdit?.()
            }
            onChange(sanitized)
          }}
          onBlur={reEcho(onChange)}
          inputMode="decimal"
          placeholder="0.00"
          className={inputClass(true)}
          aria-label={label}
          aria-required="true"
        />
      </div>
      {/* Help sits directly under its own input, BEFORE any adjunct control:
          it carries the unit, and pushing it below the income-period selector
          made it read as that select's help instead of this field's. */}
      <p className="text-sm text-muted mt-1">{help}</p>
      {children}
    </div>
  )

  // A derived, non-editable money figure (story 29.2). A called render helper for
  // the same reason `currencyField` is one — nothing is defined as a component in
  // a render body here.
  //
  // Rendered as a stat card rather than a read-only input: this repo has no
  // read-only-input convention at all, and its established shape for a figure the
  // app computed for you is the label/value card (`BalancePage`'s "Total
  // Investments" stat card, and the Overview's own tiles). A greyed-out
  // box that still looks like a text field invites people to click and type into
  // something that can never accept input.
  const derivedField = ({
    id,
    label,
    caption,
    figure,
  }: {
    id: string
    label: string
    caption: string
    figure: DerivedFigure
  }) => (
    <div className="surface-inset p-4 rounded-lg" data-testid={id}>
      <dt className="text-sm text-muted">{label}</dt>
      {/* These values change on their own when the Balance/Income/Expenses stores
          update, with no action from the user — announce it rather than mutating
          silently under a screen reader. */}
      <dd className="mt-1" aria-live="polite">
        <span className="block text-2xl font-bold text-subheading">
          {formatAmount(figure.cents)}
        </span>
        {/* The provenance caption shows ONLY for a real figure. In every other
            state the displayed 0.00 does not come from the named source — it is a
            placeholder — so "From your investment accounts" would be a false
            claim. The note below names the source itself in those cases, so
            nothing is lost. */}
        {figure.state === 'ok' && <span className="block text-xs text-muted mt-1">{caption}</span>}
        {figure.note !== null && (
          <span className="block text-xs text-muted mt-1">{figure.note}</span>
        )}
      </dd>
    </div>
  )

  // The AC-4 caveat, rendered inside whichever results branch is showing so it
  // travels with the numbers it qualifies rather than sitting far above them.
  //
  // Covers BOTH a floored-from-negative figure and an unreadable one. An
  // unreadable source is not "honestly zero" — it is unknown, and the solver was
  // handed a fabricated zero for it, so a confident outlook built on that must
  // say so.
  const resultsCaveat = (toneClass: string) => {
    if (!flooredFromNegative && !derivedUnreadable) {
      return null
    }
    return (
      <p data-testid="derived-floor-disclosure" className={`text-xs mt-4 ${toneClass}`}>
        {derivedUnreadable
          ? 'Some of your saved data could not be read, so this projection assumes zero for it — treat these figures as incomplete.'
          : 'A figure above came out below zero, so this projection treats it as zero — your real position is worse than these numbers suggest.'}
      </p>
    )
  }

  return (
    <div className="space-y-8">
      {/* ── Derived figures (story 29.2) ─────────────────────────────────────
          Two values the app already holds, shown rather than asked for. They sit
          above the input set because they are context for the plan, not part of
          filling it in. */}
      <div>
        <h3 className="text-lg font-semibold text-subheading mb-4">Your Savings Position</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {derivedField({
            id: 'derived-current-saved',
            label: 'Current Amount Saved',
            caption: 'From your investment accounts',
            figure: derivedCurrentSaved,
          })}

          {derivedField({
            id: 'derived-monthly-savings',
            label: 'Monthly Savings',
            caption: 'What you put into your investment accounts each month',
            figure: derivedMonthlySavings,
          })}
        </dl>
      </div>

      {/* ── The single shared input set ──────────────────────────────────────
          Every figure the planner, the required-nest-egg calculation and the
          growth chart need, collected exactly once. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="currentAge" className="block text-sm font-medium text-label mb-2">
            Current Age
          </label>
          <input
            type="number"
            id="currentAge"
            name="currentAge"
            value={currentAgeInput}
            onChange={(e) => setCurrentAgeInput(e.target.value)}
            inputMode="numeric"
            min="0"
            step="1"
            placeholder="35"
            className={inputClass(false)}
            aria-label="Current Age"
            aria-required="true"
          />
          <p className="text-sm text-muted mt-1">Your age today, in years</p>
        </div>

        <div>
          <label htmlFor="lifeExpectancy" className="block text-sm font-medium text-label mb-2">
            Life Expectancy
          </label>
          <input
            type="number"
            id="lifeExpectancy"
            name="lifeExpectancy"
            value={lifeExpectancyInput}
            onChange={(e) => setLifeExpectancyInput(e.target.value)}
            inputMode="numeric"
            min="0"
            step="1"
            placeholder="90"
            className={inputClass(false)}
            aria-label="Life Expectancy"
            aria-required="true"
          />
          <p className="text-sm text-muted mt-1">The age you plan through</p>
        </div>

        {/* Spans the full row so the two rate fields below can sit side by side
            as the pair they are, rather than one of them being orphaned. */}
        <div className="sm:col-span-2">
          {currencyField({
            id: 'desiredIncome',
            label: 'Desired Retirement Income',
            help: `The ${incomeBasis} income you want in retirement`,
            value: desiredIncomeInput,
            onChange: setDesiredIncomeInput,
            onUserEdit: () => markDesiredIncomeAuthored(locale),
            children: (
              <div className="mt-2">
                <label htmlFor="incomeBasis" className="block text-sm font-medium text-label mb-1">
                  Income period
                </label>
                <select
                  id="incomeBasis"
                  value={incomeBasis}
                  onChange={(e) => setIncomeBasis(e.target.value as IncomeBasis)}
                  className={`w-full px-3 py-2 ${controlChrome}`}
                >
                  <option value="annual">Annual</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            ),
          })}
        </div>

        <div>
          <label htmlFor="annualReturn" className="block text-sm font-medium text-label mb-2">
            Expected Annual Return
          </label>
          <div className="relative">
            <input
              type="number"
              id="annualReturn"
              name="annualReturn"
              value={annualReturnInput}
              onChange={(e) => setAnnualReturnInput(e.target.value)}
              inputMode="decimal"
              min="0"
              step="0.1"
              placeholder="6.0"
              className={`${inputClass(false)} pr-10`}
              aria-label="Expected Annual Return"
              aria-required="true"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
              %
            </span>
          </div>
          {/* The second clause is TRUE ONLY under `deplete`, where this rate doubles
              as the income-growth term of the required-nest-egg annuity. Under
              `perpetual` the requirement is income ÷ post-retirement rate and this
              rate touches nothing but the growth curve — pinned by the core test
              asserting a 0.12 accumulation rate does not move a perpetual target. */}
          <p className="text-sm text-muted mt-1">
            {model === 'deplete'
              ? 'Expected yearly return while you are still saving — under this model it also sets how fast your retirement income is assumed to rise'
              : 'Expected yearly return while you are still saving'}
          </p>
        </div>

        {/* ⚠️ Structure copied from the field above, identifiers deliberately NOT:
            reusing id="annualReturn" would put two controls behind one <label>,
            which is the exact defect the #currentAge uniqueness assertion in the
            planner's test file exists to catch. */}
        <div>
          <label
            htmlFor="postRetirementReturn"
            className="block text-sm font-medium text-label mb-2"
          >
            Post-Retirement Annual Return
          </label>
          <div className="relative">
            <input
              type="number"
              id="postRetirementReturn"
              name="postRetirementReturn"
              value={effectivePostRetirementReturnInput}
              // One store action writes the rate AND its touched flag, so the
              // pair can never be persisted out of step (story 44.1, AC-3).
              onChange={(e) => setPostRetirementReturn(e.target.value)}
              inputMode="decimal"
              min="0"
              step="0.1"
              placeholder="6.0"
              className={`${inputClass(false)} pr-10`}
              aria-label="Post-Retirement Annual Return"
              aria-required="true"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
              %
            </span>
          </div>
          {/* The "follows the rate above" clause stops being true the moment the
              user edits this field, and nothing ever resets `postRetirementTouched`
              — so it must disappear then rather than keep asserting a behaviour
              that has permanently ended. Since 44.1 the flag is PERSISTED with the
              rate, so "permanently" now outlives the session: a restored plan must
              show the hint that matches its own state, which is why one store
              action writes both halves. */}
          <p className="text-sm text-muted mt-1">
            {postRetirementTouched
              ? 'What your savings earn once you retire — lower it to model a safer allocation'
              : 'What your savings earn once you retire — lower it to model a safer allocation. Follows the rate above until you change it'}
          </p>
        </div>
      </div>

      {/* Model toggle.

          ⚠️ THE <fieldset> IS A TRANSPARENT GROUPING WRAPPER; THE PANEL IS THE
          <div> BELOW (story 44.2, UX-DR49). Do not move `p-4 surface-inset
          rounded-lg` back onto the fieldset — that is the defect, and the reason
          is not the one the epic gives.

          A `<legend>` that is the fieldset's first child is the "rendered
          legend": the browser lays it out against the fieldset's BORDER edge, so
          the fieldset's own padding never applies to it. With the panel styling
          on the fieldset the title sat 0px from the filled panel's top edge while
          every radio below sat 16px in. MEASURED at 320px and 1280px before the
          fix: `legend.top - fieldset.top === 0`, and `panel.top - legend.bottom
          === -20px`.

          ⚠️ It did NOT overflow or straddle the box, which is what `epics.md:445`
          claims — `legendInsideBox` was already `true`. That matters because the
          containment guard a reader of the epic would write passes on the broken
          code. `e2e/retirement-model-group.spec.ts` asserts the label's position
          RELATIVE TO THE PANEL instead, which genuinely reverses.

          ⚠️ THE PANEL-STYLING MOVE IS THE FIX. `float-left` / `clear-both` are
          NOT load-bearing here, and an earlier version of this comment claimed
          they were. MEASURED in Chromium: dropping either one leaves all eleven
          e2e geometry assertions green and the layout visually identical —
          because with a transparent, unpadded fieldset the rendered legend's
          placement is indistinguishable from an ordinary block's.

          They are kept as cross-browser insurance, not decoration: per spec a
          first-child `<legend>` is the rendered legend unless it is floated or
          positioned, and Playwright runs Chromium only, so Firefox and Safari
          are unverified here. The unit suite pins both tokens for that reason.

          Two alternatives WERE measured and rejected: floating the legend while
          the fieldset kept its padding blew the group's height 154 -> 402
          (uncontained float), and `position: absolute` collapsed it to 134 with
          the radios riding under the label.

          The <legend> REMAINS THE FIRST CHILD — that is what gives the radio
          group its accessible name, and this is the app's only fieldset/legend,
          so there is no second instance to copy the pattern from. */}
      <fieldset>
        <legend className="float-left w-full block text-sm font-medium text-label mb-2">
          Retirement target model
        </legend>
        <div
          data-testid="retirement-model-panel"
          className="clear-both p-4 surface-inset rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {(
            Object.entries(MODEL_COPY) as [
              RetirementModel,
              { label: string; explanation: string },
            ][]
          ).map(([key, copy]) => (
            <label
              key={key}
              className={`flex gap-3 p-3 min-h-[44px] rounded-lg border cursor-pointer transition-colors ${
                model === key
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
            >
              <input
                type="radio"
                name="retirementModel"
                value={key}
                checked={model === key}
                onChange={() => setModel(key)}
                className="mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span>
                <span className="block font-medium text-subheading">{copy.label}</span>
                <span className="block text-sm text-muted mt-1">{copy.explanation}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── Results ─────────────────────────────────────────────────────────
          Four mutually exclusive states. Gates key on `status === 'solved'`,
          never on truthiness of the solve state: when every gate went falsy at
          once the page rendered a silent blank void (story 26.7 review). */}
      {!parsed.ok && (
        <div className="p-4 surface-inset rounded-lg text-body" role="status">
          {parsed.reason === 'invalid'
            ? 'Please check your inputs — one of the values is not a valid number.'
            : 'Enter all the details above to see your retirement outlook.'}
        </div>
      )}

      {solved?.status === 'failed' && (
        <div
          data-testid="accumulation-solve-failed"
          className="p-4 surface-inset rounded-lg text-body"
          role="status"
        >
          <p>
            Those numbers are too large to compute. Please check your inputs — a value like age or
            life expectancy looks out of range.
          </p>
          {solved.detail && <p className="text-sm mt-2">{solved.detail}</p>}
          {resultsCaveat('text-body')}
        </div>
      )}

      {/* ⚠️ `!noSourceData` added by story 47.2, and it closes a contradiction
          that story WIDENED rather than created. `noSourceData` used to require
          both sources empty; now that both figures read the investment rows it
          means "no investment accounts", which is the ordinary state of someone
          who has entered income and expenses and nothing else. With a desired
          income of 0 the solve succeeds and reports `reachable`, so this panel
          rendered a confident all-zero outlook directly above the chart's "add
          your investment accounts" placeholder — which was already gated on
          `noSourceData` while this one was not. */}
      {solved?.status === 'solved' && solved.result.reachable && !noSourceData && (
        <div
          data-testid="accumulation-outputs"
          className="p-6 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded-xl"
        >
          <h3 className="text-lg font-semibold text-green-800 dark:text-green-300 mb-4">
            Your Retirement Outlook
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            <OutputRow
              label="Saved per year"
              value={formatAmount(solved.result.savedPerYearCents)}
            />
            <OutputRow label="Total saved" value={formatAmount(solved.input.currentSavedCents)} />
            <OutputRow
              label="Months to retirement"
              value={String(solved.result.monthsToRetirement)}
            />
            <OutputRow
              label="Years to retirement"
              value={(solved.result.yearsToRetirement ?? 0).toFixed(1)}
            />
            <OutputRow
              label="Earliest retirement age"
              value={String(Math.round(solved.result.earliestRetirementAge ?? 0))}
            />
            <OutputRow
              label="Nest egg at retirement"
              value={formatAmount(solved.result.projectedNestEggCents ?? 0)}
            />
            <OutputRow
              label="Required nest egg"
              value={formatAmount(solved.result.requiredNestEggCents ?? 0)}
            />
            {/* Restored in review: the retired form's "Gap to Goal" was the one
                output in its progress panel with no equivalent here — the outputs
                gave a required and a projected figure but never the distance
                between what you have TODAY and what you need. Measured against
                current savings, not the projected nest egg: on this branch the
                projection has by definition already met the target, so
                required − projected would always read zero and tell nobody
                anything. The form's own gap used today's assets too. */}
            <OutputRow
              label="Still to accumulate"
              value={
                (solved.result.requiredNestEggCents ?? 0) - solved.input.currentSavedCents <= 0
                  ? 'Already covered'
                  : formatAmount(
                      (solved.result.requiredNestEggCents ?? 0) - solved.input.currentSavedCents
                    )
              }
            />
          </dl>
          {model === 'perpetual' && (
            // The perpetual required nest egg IS the Safe Withdrawal Model's
            // "required retirement assets" — one figure, stated once. The page
            // used to compute it a second time in a standalone form beside this.
            // The formula itself is NOT repeated here: it is stated once on the
            // page, in the explanation card below.
            <p className="text-xs text-green-600 dark:text-green-400 mt-4">
              Required nest egg uses the Safe Withdrawal Model — enough to withdraw{' '}
              {formatAmount(toMonthlyIncomeCents(solved.input.desiredAnnualIncomeCents, 'annual'))}{' '}
              a month without touching the principal.
            </p>
          )}
          {resultsCaveat('text-green-700 dark:text-green-300')}
        </div>
      )}

      {/* `|| noSourceData` is the other half of the gate above: a no-data user
          whose plan happens to solve must still land on this block's own
          no-data arm rather than on nothing at all. */}
      {solved?.status === 'solved' && (!solved.result.reachable || noSourceData) && (
        <div
          data-testid="accumulation-not-reachable"
          className="p-6 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl text-body"
          role="status"
        >
          {solved.input.currentAge >= solved.input.lifeExpectancy ? (
            // Targeted copy for the age-window case: the blocker is the ages, not
            // the savings, so the generic "save more" levers would mislead.
            <>
              <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-2">
                Your current age is at or past your life expectancy
              </h3>
              <p className="text-sm">
                There&rsquo;s no retirement window to plan for. Set a life expectancy greater than
                your current age to see your outlook. You still save{' '}
                <strong>{formatAmount(solved.result.savedPerYearCents)}</strong> per year.
              </p>
            </>
          ) : noSourceData ? (
            // Nothing to grow. Before 29.2 these users sat in the calm "fill in
            // the details" state, because the two now-derived fields were empty
            // and held the incomplete gate shut. The gate no longer waits on
            // them, so this case now reaches the solver — and the generic levers
            // below would tell a brand-new user their retirement is unreachable
            // and to "save more each month" on a page with no savings control.
            <>
              <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-2">
                We don&rsquo;t have your savings data yet
              </h3>
              <p className="text-sm">
                This plan has nothing to grow yet. Add your investment accounts on the Balance
                Tracking page, along with what you put into them each month — both figures above
                fill in automatically, and your outlook appears here.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-2">
                Retirement isn&rsquo;t reachable with these numbers
              </h3>
              <p className="text-sm">
                Your savings don&rsquo;t reach the nest egg this plan needs before your life
                expectancy. You still save{' '}
                <strong>{formatAmount(solved.result.savedPerYearCents)}</strong> per year — try one
                of these levers:
              </p>
              {/* ⚠️ The first two levers name OTHER pages on purpose: since 29.2
                  the savings figures are derived, so there is no "save more"
                  control on this screen to act on. */}
              <ul className="list-disc pl-5 mt-3 text-sm space-y-1">
                <li>Put more into your investment accounts on the Balance Tracking page</li>
                <li>Retire on a lower annual income</li>
                {/* ⚠️ Deliberately names ONLY the post-retirement rate. Raising the
                    SAVING-phase rate is no longer reliably helpful under `deplete`:
                    it also drives the assumed income-growth term, so it inflates the
                    requirement as well as the projection. Measured on the real solver
                    (age 64, life 95, post rate held at 6%), raising it 6% → 8% → 10%
                    pushed earliest retirement 27 → 48 → 63 months — further away. A
                    higher POST-retirement rate always lowers the requirement in both
                    models, so it is the only lever safe to state unconditionally. */}
                <li>Assume a higher return after you retire</li>
                <li>Extend your life-expectancy horizon</li>
              </ul>
            </>
          )}
          {resultsCaveat('text-amber-800 dark:text-amber-300')}
        </div>
      )}

      {/* ── Growth over time ────────────────────────────────────────────────
          The same inputs, the same monthly-compounded math, drawn out year by
          year. No second input set. The chart is pure ACCUMULATION, so it takes
          the accumulation rate only — the post-retirement rate describes what
          happens after this curve ends and deliberately does not appear here. */}
      <div>
        <h3 className="text-lg font-semibold text-subheading mb-4">
          Your Savings Until Retirement
        </h3>
        {solved?.status === 'solved' && parsed.ok && !noSourceData ? (
          <RetirementTimelineChart
            currentSavedCents={parsed.input.currentSavedCents}
            monthlySavingsCents={parsed.input.monthlySavingsCents}
            annualReturnRate={parsed.input.annualReturnRate}
            currentAge={parsed.input.currentAge}
            yearsToProject={chartHorizonYears(parsed.input, solved.result)}
            earliestRetirementAge={
              solved.result.reachable ? solved.result.earliestRetirementAge : null
            }
          />
        ) : (
          // Three distinct states, not two. Folding `failed` in with "not filled
          // in yet" put "Fill in the details above" directly beneath a panel
          // saying the numbers were too large to compute — two contradictory
          // instructions on one screen.
          <div className="p-8 text-center text-muted surface-inset rounded-lg">
            <p>
              {solved?.status === 'failed'
                ? 'No projection — the numbers above are out of range.'
                : parsed.ok === false && parsed.reason === 'invalid'
                  ? 'No projection — one of the values above is not a valid number.'
                  : noSourceData
                    ? // Without a balance or a budget the curve is a flat line at
                      // zero, and the summary beneath it would confidently report
                      // reaching 0.00 decades from now. Say nothing rather than that.
                      'No projection yet — add your investment accounts to see how your savings grow.'
                    : 'Fill in the details above to see how your savings grow.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** A single label / value row in the outputs list. */
function OutputRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <dt className="text-sm text-green-700 dark:text-green-300">{label}</dt>
      <dd className="font-semibold text-green-800 dark:text-green-200">{value}</dd>
    </div>
  )
}

export function RetirementAccumulationPlanner() {
  return (
    <ErrorBoundary>
      <RetirementAccumulationPlannerInner />
    </ErrorBoundary>
  )
}

export default RetirementAccumulationPlanner
