// Assembled from local stores and printed via window.print(): no figure may leave the device.
// Retirement outlook and net-worth projection are deliberately excluded (no persisted source).

import { denormalizeFromMonthly } from '@budget-planner/core/finance/normalization'
import type React from 'react'
import { useMemo, useState } from 'react'
import {
	buildFinancialSummary,
	type FinancialSummaryReportModel,
	type ReportCashflowRow,
} from '../../lib/report/build-financial-summary'
import { useBalanceEntries } from '../../stores/balanceStore'
import { useFormattedAmount } from '../../stores/currencyStore'
import { useExpenses } from '../../stores/expenseStore'
import { useIncomeSources } from '../../stores/incomeStore'
import { useSavingsGoals } from '../../stores/savingsStore'
import { GroupedAmount } from '../ui/GroupedAmount'
import { RESPONSIVE_SCROLL_SHADOW_CLASS, RESPONSIVE_WRAPPER_CLASS } from '../ui/ResponsiveTable'
import { TableScrollRegion } from '../ui/TableScrollRegion'

const FREQUENCY_LABELS: Record<string, string> = {
	weekly: 'Weekly',
	biweekly: 'Biweekly',
	monthly: 'Monthly',
	annually: 'Annually',
}

// Both members are core Frequency values, so denormalizeFromMonthly is the one conversion rule.
// Deliberately not the persisted overviewDurationStore: the report always opens monthly.
type BudgetPeriod = 'monthly' | 'annually'

const BUDGET_PERIOD_LABEL: Record<BudgetPeriod, { option: string; word: string }> = {
	monthly: { option: 'Monthly', word: 'Monthly' },
	annually: { option: 'Annually', word: 'Annual' },
}

// Derived from the label record so a new period cannot be silently omitted.
const BUDGET_PERIODS = Object.keys(BUDGET_PERIOD_LABEL) as readonly BudgetPeriod[]

// Must not contain 'amounts' or 'currency': page-wide guards assert neither word is rendered.
const BUDGET_PERIOD_LABEL_TEXT = 'Show the budget per'

const TABLE_CLASS = 'min-w-full divide-y divide-gray-200 dark:divide-gray-700'

// A four-column table is wider than a phone card, so it scrolls in its own region.
// The print: resets keep wide tables unclipped and the shadow gradients off paper.
const TABLE_REGION_CLASS = `${RESPONSIVE_WRAPPER_CLASS} ${RESPONSIVE_SCROLL_SHADOW_CLASS} mt-3 print:overflow-visible print:bg-none`

// `anywhere` (not break-word) lowers min-content so long names cannot widen tables, on screen or paper;
// max-sm:min-w keeps ordinary names from splitting mid-word on phones.
const NAME_WRAP_CLASS = '[overflow-wrap:anywhere] max-sm:min-w-[8rem]'

const TH_CLASS = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-label'
const TH_NUMERIC_CLASS = `${TH_CLASS} text-right`
const TD_CLASS = 'px-3 py-2 text-sm text-body'
const TD_NUMERIC_CLASS = `${TD_CLASS} text-right tabular-nums`
const SECTION_CLASS = 'surface border-default mt-6 rounded-lg border p-4 sm:p-6'
const SECTION_HEADING_CLASS = 'text-lg font-semibold text-heading'

// Shared by both print buttons; a test asserts their class attributes are equal.
const PRINT_BUTTON_CLASS =
	'rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'

// justify-end keeps the lone button right; flex-wrap and gap-3 are inert but keep both rows one shape.
const PRINT_ROW_CLASS = 'flex flex-wrap items-center justify-end gap-3'

function formatPercent(percent: number | null): string {
	return percent === null ? '—' : `${Math.round(percent)}%`
}

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
		<TableScrollRegion label={`${caption} table`} className={TABLE_REGION_CLASS}>
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
							{/* Explicit text-left: an unstyled <th> takes the UA default centre and Preflight does not reset it.
                 Per call site, not on TD_CLASS, which TD_NUMERIC_CLASS extends with text-right. */}
							<th scope="row" className={`${TD_CLASS} font-normal text-left ${NAME_WRAP_CLASS}`}>
								{row.name}
							</th>
							{/* What the user entered: unaffected by the period control. */}
							<td className={TD_NUMERIC_CLASS}>{format(row.amountCents)}</td>
							<td className={TD_CLASS}>{FREQUENCY_LABELS[row.frequency] ?? row.frequency}</td>
							{/* At the row's own cadence print what was typed: round-tripping the rounded monthly cents is lossy
                 (100.00/yr gives 99.96). Accepted cost: the column may differ from the total by a few cents. */}
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
		</TableScrollRegion>
	)
}

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
		// The label gives up width first so a wrapped value stays right-aligned.
		<div className="border-default flex items-baseline justify-between gap-4 border-t py-2">
			<dt
				className={
					emphasis
						? 'shrink-[1000] text-sm font-semibold text-heading'
						: 'shrink-[1000] text-sm text-label'
				}
			>
				{label}
			</dt>
			<dd
				className={
					emphasis
						? 'text-right text-base font-semibold tabular-nums text-heading'
						: 'text-right text-sm tabular-nums text-body'
				}
			>
				<GroupedAmount text={value} />
			</dd>
		</div>
	)
}

// Must distinguish 'nothing added' from 'nothing readable', or it contradicts the disclosure below.
function emptySectionCopy(unreadableCount: number, nothingAdded: string): string {
	return unreadableCount > 0
		? 'None of the entries saved for this section could be read, so it has no figures to show.'
		: nothingAdded
}

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

export type FinancialSummaryReportProps = {
	// Injected by tests for determinism; production stamps today.
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

	const [budgetPeriod, setBudgetPeriod] = useState<BudgetPeriod>('monthly')
	const periodWord = BUDGET_PERIOD_LABEL[budgetPeriod].word

	// budgetPeriod is deliberately not a dependency: the period applies at render, not to the model.
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
		// w-full is load-bearing: auto margins switch off flex stretching, so the column would size to its widest table.
		<main className="mx-auto w-full max-w-3xl px-4 py-10">
			{/* data-print-hide: the print control must not appear on the printed page. */}
			<div data-print-hide className={`mb-6 ${PRINT_ROW_CLASS}`}>
				<button type="button" onClick={() => window.print()} className={PRINT_BUTTON_CLASS}>
					Print / Save as PDF
				</button>
			</div>

			<article id="financial-summary-report" aria-labelledby="report-heading">
				<header>
					<h1 id="report-heading" className="text-2xl font-bold text-heading">
						Financial Summary
					</h1>
					{/* Inside the article so the date prints; filed printouts need it. */}
					<p className="mt-1 text-sm text-muted">Generated {model.generatedAtISO}</p>
				</header>

				{/* Gate on unreadable rows too: 'nothing to report' must mean nothing stored, not nothing readable. */}
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
								{/* Screen-only reading aid inside the article: the section still prints the selected period.
                   See BUDGET_PERIOD_LABEL_TEXT before renaming. */}
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
									{/* Period-aware because the control is hidden in print; must not contain 'amounts' or 'currency'. */}
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
									{/* Break-even is deliberately reported as a deficit (core's isSurplus). */}
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
										{/* Printed here too so the lines above the total add up to it. */}
										<TotalRow
											label="Total savings"
											value={format(model.netWorth.totalSavingsCents)}
										/>
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
							{/* If savings rows were excluded this figure is missing money and must say so. */}
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
									<TableScrollRegion
										label="Goals and accounts table"
										className={TABLE_REGION_CLASS}
									>
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
														{/* text-left: same UA-default fix as CashflowTable's row header. */}
														<th
															scope="row"
															className={`${TD_CLASS} font-normal text-left ${NAME_WRAP_CLASS}`}
														>
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
									</TableScrollRegion>
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
							{/* Disclose a stripped corrupt target, or it looks like a genuine no-target account. */}
							{model.savings.unreadableTargetCount > 0 && (
								<p className="mt-3 text-sm text-muted">
									{model.savings.unreadableTargetCount === 1
										? "1 entry's target could not be read, so its balance is included but its progress is not shown."
										: `${model.savings.unreadableTargetCount} entries' targets could not be read, so their balances are included but their progress is not shown.`}
								</p>
							)}
						</section>

						{/* Inside the article, so data-print-hide alone keeps it off paper; inside this branch so the
               empty document does not get a second button. */}
						<div data-print-hide className={`mt-6 ${PRINT_ROW_CLASS}`}>
							<button type="button" onClick={() => window.print()} className={PRINT_BUTTON_CLASS}>
								Print / Save as PDF
							</button>
						</div>
					</>
				)}
			</article>
		</main>
	)
}

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
		<TableScrollRegion label={`${caption} table`} className={TABLE_REGION_CLASS}>
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
							{/* text-left: same UA-default fix as CashflowTable's row header. */}
							<th scope="row" className={`${TD_CLASS} font-normal text-left ${NAME_WRAP_CLASS}`}>
								{row.name}
							</th>
							<td className={TD_NUMERIC_CLASS}>{format(row.balanceCents)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</TableScrollRegion>
	)
}
