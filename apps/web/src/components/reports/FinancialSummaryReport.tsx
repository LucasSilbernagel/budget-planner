/**
 * Premium printable financial summary (Story 30.3, FR53).
 *
 * Renders the persisted picture of a user's finances — budget, current net worth
 * and savings — as a plain, print-ready document, and offers a button that hands
 * it to the browser's own print dialog (where "Save as PDF" lives).
 *
 * ## Everything happens in this browser
 *
 * The model is assembled by the pure {@link buildFinancialSummary} from data
 * already in the local stores, and printing is `window.print()`. There is no
 * fetch, no server function, no third-party service, and no asset request — so
 * no financial figure leaves the device to produce this report (NFR1/NFR2). That
 * is a property of the code, not a promise: adding any network call here would
 * break it, and a test asserts `fetch` is never called.
 *
 * ## What this report does NOT contain, and why
 *
 * No retirement outlook and no forward net-worth projection.
 *
 * The retirement outlook is driven entirely by ephemeral component state —
 * `RetirementAccumulationPlanner` holds its assumptions in `useState` with no
 * store and no persistence key — so there is nothing for a report opened from
 * `/settings` to read. Including it would mean inventing assumptions and
 * presenting the output as the user's plan.
 *
 * The forward net-worth projection has no source at all: story 43.3 (FR69)
 * removed the free projection page, and Premium forecasting's projection is a
 * what-if scenario the user types, not a statement about their real position.
 *
 * ⚠️ Both exclusions narrow FR53 DELIBERATELY. This paragraph is the record of
 * that decision — a later reader who finds the report "missing" a projection
 * should read this before adding one back.
 *
 * No charts either: Recharts sizes its SVG from a client-measured container and
 * prints unreliably, and a tabular summary gains nothing from it.
 *
 * ## Rendering is client-side by necessity
 *
 * Every store is `skipHydration: true` and rehydrates on mount via
 * `StoreHydration`, so the server render and the first client paint both see
 * EMPTY stores. This component therefore reads live store state and must be
 * asserted post-hydration; an SSR/HTML smoke would happily pass against an empty
 * document.
 */

import { denormalizeFromMonthly } from '@budget-planner/core/finance'
import { useMemo, useState } from 'react'
import type React from 'react'
import {
  type FinancialSummaryReportModel,
  type ReportCashflowRow,
  buildFinancialSummary,
} from '../../lib/report/build-financial-summary'
import { useBalanceEntries } from '../../stores/balanceStore'
import { useFormattedAmount } from '../../stores/currencyStore'
import { useExpenses } from '../../stores/expenseStore'
import { useIncomeSources } from '../../stores/incomeStore'
import { useSavingsGoals } from '../../stores/savingsStore'

/** How a frequency reads in the report's own prose. */
const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  annually: 'Annually',
}

/**
 * The period the Budget section's DERIVED figures are expressed in (story 56.3,
 * FR84).
 *
 * ⚠️ Both members are also valid core `Frequency` values, and that is
 * load-bearing: it lets `denormalizeFromMonthly` take the period directly, so
 * there is exactly ONE conversion rule with no `monthly`-vs-`annually` branch
 * anywhere in this file (`monthly` is ×1, i.e. the identity). Re-deriving from
 * a row's entered `amount`/`frequency`, or hand-writing `× 12`, would create a
 * second rule — the thing FR84's acceptance criteria explicitly forbid.
 *
 * ⚠️ NOT `OverviewDuration` and NOT the shared `overviewDurationStore`. That
 * store is persisted, defaults to `annually`, and is written by the dashboard
 * and the Income/Expenses pages — wiring it in here would change the report's
 * default view for every existing user and make a toggle on a printed document
 * silently move three other screens. This report is a point-in-time document,
 * so its period is local, ephemeral, and monthly on every visit.
 */
type BudgetPeriod = 'monthly' | 'annually'

/**
 * Everything that varies with the period, in ONE place.
 *
 * `word` is used by BOTH the derived column header and the three section total
 * labels. Two independent literals are how a header and its totals drift apart
 * — the column saying "Annual" over figures labelled "Monthly" is a wrong
 * document, not a cosmetic bug.
 */
const BUDGET_PERIOD_LABEL: Record<BudgetPeriod, { option: string; word: string }> = {
  monthly: { option: 'Monthly', word: 'Monthly' },
  annually: { option: 'Annually', word: 'Annual' },
}

/**
 * Render order for the control's options. Derived from the label record rather
 * than written out a second time — the `overviewDurationStore` lesson: a
 * hand-written `readonly BudgetPeriod[]` happily accepts a SUBSET, so adding a
 * third period to the union alone would type-check, leave every test green and
 * silently omit the new option from the list.
 */
const BUDGET_PERIODS = Object.keys(BUDGET_PERIOD_LABEL) as readonly BudgetPeriod[]

/**
 * Accessible name for the period control.
 *
 * ⚠️ DO NOT use the words "amounts" or "currency" here. Story 56.1 (UX-DR62)
 * left two guards asserting `document.body.textContent` matches neither
 * `/currency/i` nor `/amounts\b/i`, and they run with this section rendered —
 * so "Show amounts per" turns two passing tests red, and the tempting repair
 * (loosening those regexes) would delete 56.1's guard instead. Phrasing follows
 * the sibling control at `HomePage.tsx:624` ("Show income and expenses per").
 */
const BUDGET_PERIOD_LABEL_TEXT = 'Show the budget per'

const TABLE_CLASS = 'mt-3 min-w-full divide-y divide-gray-200 dark:divide-gray-700'
const TH_CLASS = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-label'
const TH_NUMERIC_CLASS = `${TH_CLASS} text-right`
const TD_CLASS = 'px-3 py-2 text-sm text-body'
const TD_NUMERIC_CLASS = `${TD_CLASS} text-right tabular-nums`
const SECTION_CLASS = 'surface border-default mt-6 rounded-lg border p-4 sm:p-6'
const SECTION_HEADING_CLASS = 'text-lg font-semibold text-heading'

/**
 * A whole-percent rendering, or an em-dash when there is nothing to measure
 * against. Never renders `NaN%` — the model guarantees `null` in that case
 * rather than a division result.
 */
function formatPercent(percent: number | null): string {
  return percent === null ? '—' : `${Math.round(percent)}%`
}

/**
 * Rows plus their normalized column, shared by the income and expense tables.
 *
 * The model stores every row's figure MONTHLY-canonical (`monthlyCents`); this
 * component re-expresses that one column at `period` (story 56.3). The entered
 * `Amount` and `Frequency` columns state what the user typed and never move.
 */
function CashflowTable({
  caption,
  rows,
  format,
  period,
}: {
  caption: string
  rows: readonly ReportCashflowRow[]
  format: (cents: number) => string
  period: BudgetPeriod
}): React.ReactElement {
  return (
    <table className={TABLE_CLASS}>
      <caption className="text-left text-sm font-medium text-subheading">{caption}</caption>
      <thead className="surface-inset">
        <tr>
          <th scope="col" className={TH_CLASS}>
            Name
          </th>
          <th scope="col" className={TH_NUMERIC_CLASS}>
            Amount
          </th>
          <th scope="col" className={TH_CLASS}>
            Frequency
          </th>
          <th scope="col" className={TH_NUMERIC_CLASS}>
            {BUDGET_PERIOD_LABEL[period].word}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
        {rows.map((row) => (
          <tr key={row.id}>
            {/* Story 56.2 (UX-DR63): `text-left` is EXPLICIT here, and at the
                other two row-header sites in this file. (Deliberately worded
                without the scope attribute literal, so grepping for that
                attribute counts the three real call sites and nothing else.)
                An unstyled `<th>`
                takes the UA stylesheet's `text-align: center`, and nothing in
                this app resets it — Tailwind's Preflight declares no
                `text-align` at all (unlike Bootstrap's `th { text-align:
                inherit }`) and `global.css` has no `th` rule, so these cells
                rendered centered beneath a left-aligned `TH_CLASS` header.
                Applied per call site, NOT on the shared `TD_CLASS`:
                `TD_NUMERIC_CLASS` derives from it, so that would put
                `text-left` and `text-right` on every figure cell. Those have
                EQUAL specificity (both single-class), so the winner is decided
                by Tailwind's own emission order — correct today, and silently
                dependent on a vendor internal. Sibling precedent:
                `categories/CategoryBreakdown.tsx:390,411`. */}
            <th scope="row" className={`${TD_CLASS} font-normal text-left`}>
              {row.name}
            </th>
            {/* ⚠️ These two state what the user ENTERED, at the cadence they
                entered it. They are inert under the period control — only the
                derived column beside them moves (story 56.3). */}
            <td className={TD_NUMERIC_CLASS}>{format(row.amountCents)}</td>
            <td className={TD_CLASS}>{FREQUENCY_LABELS[row.frequency] ?? row.frequency}</td>
            {/* ⚠️ When the selected period IS the row's own entered cadence,
                print what the user typed — do not round-trip it through the
                monthly canonical figure.

                `monthlyCents` is a ROUNDED intermediate, so the round trip is
                lossy whenever the entered cents are not divisible by 12:
                100.00/Annually normalizes to 833c and denormalizes back to
                99.96, and the row would then read "100.00 | Annually | 99.96"
                — the same figure, twice, four cents apart, on a page the user
                prints and files. 1,000.01 drifts by five. (1,200.00 is exact,
                which is why a fixture of round numbers hides this entirely.)

                Story 56.3 originally forbade this branch, reasoning there must
                be exactly ONE conversion rule. AMENDED at code review
                (2026-09-17, Lucas): correctness wins over rule-count. This is
                not a second conversion — it is the ABSENCE of a conversion in
                the one case where converting can only lose information.

                ⚠️ CONSEQUENCE, accepted deliberately: the derived column no
                longer necessarily sums to the section total, which still comes
                from the model's monthly-canonical figures (×12). For an
                annually-entered row the column can differ from the total by a
                few cents. Preferred to the alternative, because a row
                contradicting its OWN entered amount is checkable at a glance
                by the person who typed it, while a few cents across a column
                is not. See the guard test naming both figures. */}
            <td className={TD_NUMERIC_CLASS}>
              {format(
                period === row.frequency
                  ? row.amountCents
                  : denormalizeFromMonthly(row.monthlyCents, period)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * A label/value line used for each section's totals. Rendered as a `<dt>`/`<dd>`
 * pair inside the section's `<dl>` — these genuinely are term/definition pairs,
 * which also makes each total addressable on its own rather than being one of
 * several identical amounts on the page (a single monthly row's amount equals
 * its normalized value equals the section total, so a page-wide text query for
 * the figure is inherently ambiguous).
 */
function TotalRow({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}): React.ReactElement {
  return (
    <div className="border-default flex items-baseline justify-between border-t py-2">
      <dt className={emphasis ? 'text-sm font-semibold text-heading' : 'text-sm text-label'}>
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? 'text-base font-semibold tabular-nums text-heading'
            : 'text-sm tabular-nums text-body'
        }
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Copy for a section with no readable rows. ⚠️ It must distinguish "you have not
 * added anything" from "what you added could not be read" — the two states looked
 * identical before, so a section whose rows were all corrupt claimed nothing had
 * been added while the disclosure directly beneath it said N entries were
 * dropped. Two lines contradicting each other on the same page.
 */
function emptySectionCopy(unreadableCount: number, nothingAdded: string): string {
  return unreadableCount > 0
    ? 'None of the entries saved for this section could be read, so it has no figures to show.'
    : nothingAdded
}

/** Disclosure shown when rows had to be excluded because they were unreadable. */
function UnreadableNote({ count }: { count: number }): React.ReactElement | null {
  if (count === 0) {
    return null
  }
  return (
    <p className="mt-3 text-sm text-muted">
      {count === 1
        ? '1 entry could not be read and is not included in these figures.'
        : `${count} entries could not be read and are not included in these figures.`}
    </p>
  )
}

export interface FinancialSummaryReportProps {
  /**
   * Overrides the report date. Supplied by tests so both the model and the
   * rendered "Generated <date>" stamp are deterministic; production passes
   * nothing and the report stamps today.
   *
   * Story 56.1 removed the currency note that used to share this line, but the
   * date itself is retained deliberately — see the UX-DR62 amendment: a printed
   * summary with no date cannot be distinguished from an older printout of the
   * same figures.
   */
  generatedAt?: Date
}

export function FinancialSummaryReport({
  generatedAt,
}: FinancialSummaryReportProps = {}): React.ReactElement {
  const income = useIncomeSources()
  const expenses = useExpenses()
  const balances = useBalanceEntries()
  const savings = useSavingsGoals()
  const format = useFormattedAmount()

  // Story 56.3 (FR84). Local and ephemeral BY DESIGN: the report opens on
  // `monthly` every visit, so the default view is unchanged for every existing
  // user and re-selecting annual is a one-click action each time. See
  // `BudgetPeriod` for why this is not the shared, persisted duration store.
  const [budgetPeriod, setBudgetPeriod] = useState<BudgetPeriod>('monthly')
  const periodWord = BUDGET_PERIOD_LABEL[budgetPeriod].word

  // ⚠️ `budgetPeriod` is deliberately NOT a dependency. The model stays
  // monthly-canonical and the period is applied at render; adding it here would
  // rebuild the whole document — and re-run every corrupt-row partition — on a
  // display toggle, for nothing.
  const model: FinancialSummaryReportModel = useMemo(
    () =>
      buildFinancialSummary({
        income,
        expenses,
        balances,
        savings,
        generatedAt: generatedAt ?? new Date(),
      }),
    [income, expenses, balances, savings, generatedAt]
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* `data-print-hide`: the control that triggers the print must not appear
          on the printed page itself. */}
      {/* Story 56.1 (UX-DR61): `justify-end`, not `justify-between`. The row
          once held a privacy disclaimer on the left and the button on the
          right; with the disclaimer gone, `justify-between` would drift the
          lone button to the left edge. `flex-wrap` and `gap-3` are inert with a
          single child and are kept for story 56.4's second print button. */}
      <div data-print-hide className="mb-6 flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          Print / Save as PDF
        </button>
      </div>

      <article id="financial-summary-report" aria-labelledby="report-heading">
        <header>
          <h1 id="report-heading" className="text-2xl font-bold text-heading">
            Financial summary
          </h1>
          {/* Story 56.1 / UX-DR62 as AMENDED (Lucas, 2026-09-17): the currency
              note that shared this line is gone, but the date stays. This is a
              document people print and file — without a date, two printouts
              months apart are indistinguishable. It sits INSIDE the <article>
              so it prints. */}
          <p className="mt-1 text-sm text-muted">Generated {model.generatedAtISO}</p>
        </header>

        {/* ⚠️ "Nothing to report" means nothing was STORED — never merely that
            nothing could be READ. Each section's `isEmpty` counts readable rows
            only, so a user whose every row is corrupt used to be told they had no
            data and should add some, while the disclosure that N entries were
            dropped lived inside the branch below and never mounted. Gating on the
            unreadable count as well keeps the two states distinguishable, which
            matters most for the user who has the most to lose. (Code review
            2026-08-09.) */}
        {model.isEmpty && model.totalUnreadableCount === 0 ? (
          <p className="mt-6 text-body">
            There is nothing to report yet. Add your income, expenses, balances or savings goals and
            this summary will fill in.
          </p>
        ) : (
          <>
            {model.isEmpty && (
              <p className="mt-6 text-body">
                None of your saved entries could be read, so this summary has no figures to show.
                Your data has not been changed — open the income, expenses, balances and savings
                pages to check the affected entries.
              </p>
            )}
            <section aria-labelledby="report-budget-heading" className={SECTION_CLASS}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="report-budget-heading" className={SECTION_HEADING_CLASS}>
                  Budget
                </h2>
                {/* Story 56.3 (FR84). Rendered only when there ARE figures to
                    re-express — a period control over "No income or expenses
                    have been added" is an affordance that does nothing.

                    `data-print-hide`: the control is a screen-only reading aid,
                    exactly like the print button. It sits INSIDE the <article>,
                    so unlike that button the section it governs still prints,
                    showing whichever figures were selected on screen.

                    Shape copied from the sibling duration selector at
                    `HomePage.tsx:621-635` rather than inventing a control type.
                    ⚠️ Read `BUDGET_PERIOD_LABEL_TEXT` before renaming this. */}
                {!model.budget.isEmpty && (
                  <div data-print-hide>
                    <label className="flex items-center gap-1 text-sm text-label">
                      <span className="sr-only">{BUDGET_PERIOD_LABEL_TEXT}</span>
                      <select
                        aria-label={BUDGET_PERIOD_LABEL_TEXT}
                        value={budgetPeriod}
                        onChange={(e) => setBudgetPeriod(e.target.value as BudgetPeriod)}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      >
                        {BUDGET_PERIODS.map((value) => (
                          <option key={value} value={value}>
                            {BUDGET_PERIOD_LABEL[value].option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              {model.budget.isEmpty ? (
                <p className="mt-2 text-sm text-body">
                  {emptySectionCopy(
                    model.budget.unreadableCount,
                    'No income or expenses have been added, so there is no budget to summarize.'
                  )}
                </p>
              ) : (
                <>
                  {/* ⚠️ PERIOD-AWARE, and it must be. The monthly wording is
                      byte-identical to what 56.1 left (that story froze this
                      section's copy), but under Annual it was flatly wrong:
                      "converted to a monthly figure" printed directly above a
                      column headed "Annual" — and the control that would
                      explain the mismatch is `data-print-hide`, so the printed
                      page offered no cue at all. Found independently by two
                      review layers, 2026-09-17.

                      The second sentence documents the round-trip fix at the
                      derived column: a yearly-entered figure is shown as typed,
                      not re-derived.

                      ⚠️ Neither string may contain "amounts" or "currency" —
                      see `BUDGET_PERIOD_LABEL_TEXT`. Both 56.1 guards run with
                      this paragraph rendered. */}
                  <p className="mt-1 text-sm text-muted">
                    {budgetPeriod === 'monthly'
                      ? 'Every entry is converted to a monthly figure so the totals are comparable.'
                      : 'Every entry is converted to a yearly figure so the totals are comparable. Anything you entered yearly is shown exactly as you typed it.'}
                  </p>
                  {model.budget.income.length > 0 && (
                    <CashflowTable
                      caption="Income"
                      rows={model.budget.income}
                      format={format}
                      period={budgetPeriod}
                    />
                  )}
                  {model.budget.expenses.length > 0 && (
                    <CashflowTable
                      caption="Expenses"
                      rows={model.budget.expenses}
                      format={format}
                      period={budgetPeriod}
                    />
                  )}
                  {/* Story 56.3: only the PERIOD WORD is interpolated. The
                      three-way status branch is otherwise untouched — the
                      break-even case in particular is a boundary the model
                      derives deliberately (core's `isSurplus` reports a deficit
                      at exactly zero), and a rewrite here would quietly lose
                      it. `periodWord` is shared with the column header above,
                      so the two cannot disagree. */}
                  <dl className="mt-4">
                    <TotalRow
                      label={`${periodWord} income`}
                      value={format(
                        denormalizeFromMonthly(model.budget.monthlyIncomeCents, budgetPeriod)
                      )}
                    />
                    <TotalRow
                      label={`${periodWord} expenses`}
                      value={format(
                        denormalizeFromMonthly(model.budget.monthlyExpensesCents, budgetPeriod)
                      )}
                    />
                    <TotalRow
                      emphasis
                      label={
                        model.budget.status === 'surplus'
                          ? `${periodWord} surplus`
                          : model.budget.status === 'deficit'
                            ? `${periodWord} shortfall`
                            : `${periodWord} net (break-even)`
                      }
                      value={format(
                        denormalizeFromMonthly(model.budget.monthlyNetCents, budgetPeriod)
                      )}
                    />
                  </dl>
                </>
              )}
              <UnreadableNote count={model.budget.unreadableCount} />
            </section>

            <section aria-labelledby="report-net-worth-heading" className={SECTION_CLASS}>
              <h2 id="report-net-worth-heading" className={SECTION_HEADING_CLASS}>
                Net worth
              </h2>
              {model.netWorth.isEmpty ? (
                <p className="mt-2 text-sm text-body">
                  {emptySectionCopy(
                    model.netWorth.unreadableCount,
                    'No investments, savings, assets or debts have been added, so there is no net worth to summarize.'
                  )}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-muted">
                    Where your balances stand today. This is not a projection.
                  </p>
                  {model.netWorth.investments.length > 0 && (
                    <BalanceTable
                      caption="Investments"
                      rows={model.netWorth.investments}
                      format={format}
                    />
                  )}
                  {model.netWorth.assets.length > 0 && (
                    <BalanceTable caption="Assets" rows={model.netWorth.assets} format={format} />
                  )}
                  {model.netWorth.debts.length > 0 && (
                    <BalanceTable caption="Debts" rows={model.netWorth.debts} format={format} />
                  )}
                  <dl className="mt-4">
                    <TotalRow
                      label="Total investments"
                      value={format(model.netWorth.totalInvestmentsCents)}
                    />
                    {/* The savings total contributes to net worth (story 32.2), so
                        it is printed here as well as in its own section — otherwise
                        the FOUR lines above the total would not add up to it on a
                        page the user keeps. The individual goals stay below. */}
                    <TotalRow
                      label="Total savings"
                      value={format(model.netWorth.totalSavingsCents)}
                    />
                    {/* Story 43.4 (FR70). Assets sit on the owned side, printed
                        between savings and debts so the column reads
                        assets-then-liabilities. */}
                    <TotalRow
                      label="Total assets"
                      value={format(model.netWorth.totalAssetsCents)}
                    />
                    <TotalRow label="Total debts" value={format(model.netWorth.totalDebtsCents)} />
                    <TotalRow emphasis label="Net worth" value={format(model.netWorth.netCents)} />
                  </dl>
                </>
              )}
              <UnreadableNote count={model.netWorth.unreadableCount} />
              {/* Savings rows are counted in their own section, but if any were
                  excluded this figure is missing money and must say so — otherwise
                  the net worth reads as complete while the Savings section below
                  discloses that entries were dropped (code review 32.2). */}
              {model.netWorth.excludedSavingsCount > 0 && (
                <p className="mt-3 text-sm text-muted">
                  {model.netWorth.excludedSavingsCount === 1
                    ? '1 savings entry could not be read and is not included in this net worth.'
                    : `${model.netWorth.excludedSavingsCount} savings entries could not be read and are not included in this net worth.`}
                </p>
              )}
            </section>

            <section aria-labelledby="report-savings-heading" className={SECTION_CLASS}>
              <h2 id="report-savings-heading" className={SECTION_HEADING_CLASS}>
                Savings
              </h2>
              {model.savings.isEmpty ? (
                <p className="mt-2 text-sm text-body">
                  {emptySectionCopy(
                    model.savings.unreadableCount,
                    'No savings goals or accounts have been added, so there is nothing to summarize.'
                  )}
                </p>
              ) : (
                <>
                  <table className={TABLE_CLASS}>
                    <caption className="text-left text-sm font-medium text-subheading">
                      Goals and accounts
                    </caption>
                    <thead className="surface-inset">
                      <tr>
                        <th scope="col" className={TH_CLASS}>
                          Name
                        </th>
                        <th scope="col" className={TH_NUMERIC_CLASS}>
                          Saved
                        </th>
                        <th scope="col" className={TH_NUMERIC_CLASS}>
                          Target
                        </th>
                        <th scope="col" className={TH_NUMERIC_CLASS}>
                          Progress
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {model.savings.goals.map((goal) => (
                        <tr key={goal.id}>
                          {/* `text-left`: see the note at `CashflowTable`'s
                              row header — same UA default, same fix. */}
                          <th scope="row" className={`${TD_CLASS} font-normal text-left`}>
                            {goal.name}
                          </th>
                          <td className={TD_NUMERIC_CLASS}>{format(goal.currentCents)}</td>
                          <td className={TD_NUMERIC_CLASS}>
                            {goal.targetCents === null ? '—' : format(goal.targetCents)}
                          </td>
                          <td className={TD_NUMERIC_CLASS}>
                            {formatPercent(goal.progressPercent)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <dl className="mt-4">
                    <TotalRow label="Total saved" value={format(model.savings.totalCurrentCents)} />
                    <TotalRow
                      label="Total target"
                      value={
                        model.savings.totalTargetCents === 0
                          ? '—'
                          : format(model.savings.totalTargetCents)
                      }
                    />
                    <TotalRow
                      emphasis
                      label="Overall progress"
                      value={formatPercent(model.savings.overallProgressPercent)}
                    />
                  </dl>
                  <p className="mt-3 text-sm text-muted">
                    A dash means there is no target to measure against — savings accounts are
                    included in the amount saved but not in the progress figure.
                  </p>
                </>
              )}
              <UnreadableNote count={model.savings.unreadableCount} />
              {/* A row kept for its balance but stripped of a corrupt target renders
                  "—" for target and progress — visually identical to a genuine
                  no-target account. Disclose it so the two are distinguishable
                  (story 32.2 code review). */}
              {model.savings.unreadableTargetCount > 0 && (
                <p className="mt-3 text-sm text-muted">
                  {model.savings.unreadableTargetCount === 1
                    ? "1 entry's target could not be read, so its balance is included but its progress is not shown."
                    : `${model.savings.unreadableTargetCount} entries' targets could not be read, so their balances are included but their progress is not shown.`}
                </p>
              )}
            </section>
          </>
        )}
      </article>
    </div>
  )
}

/** Balance rows for the net-worth section. Declared after its only consumer. */
function BalanceTable({
  caption,
  rows,
  format,
}: {
  caption: string
  rows: readonly { id: string; name: string; balanceCents: number }[]
  format: (cents: number) => string
}): React.ReactElement {
  return (
    <table className={TABLE_CLASS}>
      <caption className="text-left text-sm font-medium text-subheading">{caption}</caption>
      <thead className="surface-inset">
        <tr>
          <th scope="col" className={TH_CLASS}>
            Name
          </th>
          <th scope="col" className={TH_NUMERIC_CLASS}>
            Balance
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
        {rows.map((row) => (
          <tr key={row.id}>
            {/* `text-left`: see the note at `CashflowTable`'s row header —
                same UA default, same fix. */}
            <th scope="row" className={`${TD_CLASS} font-normal text-left`}>
              {row.name}
            </th>
            <td className={TD_NUMERIC_CLASS}>{format(row.balanceCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
