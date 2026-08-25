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

import { useMemo } from 'react'
import type React from 'react'
import {
  type FinancialSummaryReportModel,
  type ReportCashflowRow,
  buildFinancialSummary,
} from '../../lib/report/build-financial-summary'
import { useBalanceEntries } from '../../stores/balanceStore'
import { useCurrencyPreferences, useFormattedAmount } from '../../stores/currencyStore'
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

/** Rows plus their monthly-normalized column, shared by the income and expense tables. */
function CashflowTable({
  caption,
  rows,
  format,
}: {
  caption: string
  rows: readonly ReportCashflowRow[]
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
            Amount
          </th>
          <th scope="col" className={TH_CLASS}>
            Frequency
          </th>
          <th scope="col" className={TH_NUMERIC_CLASS}>
            Monthly
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
        {rows.map((row) => (
          <tr key={row.id}>
            <th scope="row" className={`${TD_CLASS} font-normal`}>
              {row.name}
            </th>
            <td className={TD_NUMERIC_CLASS}>{format(row.amountCents)}</td>
            <td className={TD_CLASS}>{FREQUENCY_LABELS[row.frequency] ?? row.frequency}</td>
            <td className={TD_NUMERIC_CLASS}>{format(row.monthlyCents)}</td>
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
   * Overrides the report date. Supplied by tests so the rendered header is
   * deterministic; production passes nothing and the report stamps today.
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
  const { mode, currency } = useCurrencyPreferences()

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

  const currencyNote =
    mode === 'none' || currency === 'NONE'
      ? 'Amounts shown without a currency symbol'
      : `Amounts in ${currency}`

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* `data-print-hide`: the control that triggers the print must not appear
          on the printed page itself. */}
      <div data-print-hide className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-body">
          This summary is built in your browser from the data on this device. Nothing is sent
          anywhere to produce it.
        </p>
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
          <p className="mt-1 text-sm text-muted">
            Generated {model.generatedAtISO} · {currencyNote}
          </p>
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
              <h2 id="report-budget-heading" className={SECTION_HEADING_CLASS}>
                Budget
              </h2>
              {model.budget.isEmpty ? (
                <p className="mt-2 text-sm text-body">
                  {emptySectionCopy(
                    model.budget.unreadableCount,
                    'No income or expenses have been added, so there is no budget to summarize.'
                  )}
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-muted">
                    Every entry is converted to a monthly figure so the totals are comparable.
                  </p>
                  {model.budget.income.length > 0 && (
                    <CashflowTable caption="Income" rows={model.budget.income} format={format} />
                  )}
                  {model.budget.expenses.length > 0 && (
                    <CashflowTable
                      caption="Expenses"
                      rows={model.budget.expenses}
                      format={format}
                    />
                  )}
                  <dl className="mt-4">
                    <TotalRow
                      label="Monthly income"
                      value={format(model.budget.monthlyIncomeCents)}
                    />
                    <TotalRow
                      label="Monthly expenses"
                      value={format(model.budget.monthlyExpensesCents)}
                    />
                    <TotalRow
                      emphasis
                      label={
                        model.budget.status === 'surplus'
                          ? 'Monthly surplus'
                          : model.budget.status === 'deficit'
                            ? 'Monthly shortfall'
                            : 'Monthly net (break-even)'
                      }
                      value={format(model.budget.monthlyNetCents)}
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
                    'No investments, savings or debts have been added, so there is no net worth to summarize.'
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
                        the three lines above the total would not add up to it on a
                        page the user keeps. The individual goals stay below. */}
                    <TotalRow
                      label="Total savings"
                      value={format(model.netWorth.totalSavingsCents)}
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
                          <th scope="row" className={`${TD_CLASS} font-normal`}>
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
            <th scope="row" className={`${TD_CLASS} font-normal`}>
              {row.name}
            </th>
            <td className={TD_NUMERIC_CLASS}>{format(row.balanceCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
