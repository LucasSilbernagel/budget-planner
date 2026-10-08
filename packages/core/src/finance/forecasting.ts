import { annualContributionCents } from '../services/balanceTracking'
import type { NormalizableFinancialItem } from './netIncome'
import { type Frequency, calculateTotalAnnualNormalized, validateAmount } from './normalization'

// Each loop iteration is a YEAR: recurring flows are annualised per item, after growth and
// rounding. One-time events are already absolute for their year and must never be scaled.
const MONTHS_PER_YEAR = 12

// Enforced by the engine: both loops run `year <= years`, so Infinity or 1e9 never finishes,
// 0 made growth 0/0, and a fraction divided growth by the wrong count.
export const MIN_FORECAST_YEARS = 1
export const MAX_FORECAST_YEARS = 30
export const DEFAULT_FORECAST_YEARS = 10

export function isValidForecastYears(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_FORECAST_YEARS &&
    value <= MAX_FORECAST_YEARS
  )
}

// Below -100% `(1 + rate) ** year` alternates sign every year; above +100% figures run to
// nonsense (1e38) long before overflowing.
export const MIN_GROWTH_RATE = -1
export const MAX_GROWTH_RATE = 1

export const GROWTH_RATE_OUT_OF_RANGE = `Growth rates must be from ${MIN_GROWTH_RATE * 100}% to ${
  MAX_GROWTH_RATE * 100
}%`

export function isValidGrowthRate(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_GROWTH_RATE &&
    value <= MAX_GROWTH_RATE
  )
}

// The engine never applies it: an investment row without a rate is refused.
export const DEFAULT_INVESTMENT_RETURN = 0.06

export const INVESTMENT_RETURN_OUT_OF_RANGE = `Investment returns must be from ${
  MIN_GROWTH_RATE * 100
}% to ${MAX_GROWTH_RATE * 100}%`

export const FORECAST_OUT_OF_RANGE = 'Forecast amounts are too large to project'

// Rows SPLIT savings, they don't add to it: net income already lands in `savings`. Counted
// investment contributions do leave savings.
export interface SavingsAccountInput {
  balance: number
  monthlyContribution: number
}

export const SAVINGS_ROWS_MISMATCH = 'Savings account balances must add up to the starting savings'

export const SAVINGS_ROW_NEGATIVE = 'Savings account balances and contributions must be 0 or more'

// `balance` is a positive MAGNITUDE for both types. A debt pays `min(annual payment, balance)`
// with no interest; an unflagged payment also leaves savings.
export interface BalanceAccountInput {
  type: 'investment' | 'debt'
  balance: number
  contribution: number
  frequency: Frequency
  // Read strictly (`=== true`): anything else means the money leaves savings, so no row
  // creates money.
  contributionRecordedAsExpense?: boolean
  // REQUIRED on an investment row (no engine default); ignored on a debt row (no debt interest).
  annualReturn?: number
}

export const BALANCE_ROW_NEGATIVE =
  'Investment and debt balances and contributions must be 0 or more'

export const ASSETS_NEGATIVE = 'Asset values must be 0 or more'

export const BALANCE_ROWS_MISMATCH = 'Investment balances must add up to the starting investments'

export const BALANCE_ROW_TYPE = 'Each balance row must be an investment or a debt'

const ROUNDING_ERROR_EPSILONS = 4
const MAX_HALF_CENT_SNAP = 1e-6

// `Math.round`, but a value within a few ulps of an exact half cent rounds as that half
// (`100 × 1.015` is 101.49999999999999). Don't widen the window without the rounding tests.
export function roundCents(x: number): number {
  const window = Math.abs(x) * Number.EPSILON * ROUNDING_ERROR_EPSILONS
  if (!(window <= MAX_HALF_CENT_SNAP)) return Math.round(x)
  const floor = Math.floor(x)
  // `floor + 0.5` is exact here, and `Math.round` of it keeps the sign of a zero
  // result (-0.5 → -0) as bare `Math.round` does.
  return Math.abs(x - floor - 0.5) <= window ? Math.round(floor + 0.5) : Math.round(x)
}

// `balance × (1 + r)`, never `balance + balance × r`, to reproduce the 7% figures to the cent.
// Pure on opening balances, so a loop can step rows before applying net income.
function stepBalanceRows(
  rows: readonly BalanceAccountInput[],
  balances: readonly number[],
  annualContributions: readonly number[],
  growthMultipliers: readonly number[]
): { balances: number[]; countedDebtPaid: number } {
  let countedDebtPaid = 0
  const closing = balances.map((balance, i) => {
    const annual = annualContributions[i] ?? 0
    const row = rows[i]
    if (row?.type === 'investment') {
      return roundCents(balance * (growthMultipliers[i] ?? 1)) + annual
    }
    const next = Math.max(0, balance - annual)
    if (row?.contributionRecordedAsExpense !== true) countedDebtPaid += balance - next
    return next
  })
  return { balances: closing, countedDebtPaid }
}

function sumRows(
  rows: readonly BalanceAccountInput[],
  balances: readonly number[],
  type: BalanceAccountInput['type']
): number {
  return balances.reduce((sum, balance, i) => (rows[i]?.type === type ? sum + balance : sum), 0)
}

// Rounding a fraction (not throwing) is parity: `validateAmount` accepts fractions for
// recurring amounts too.
function eventAmountInCents(amount: unknown): number {
  validateAmount(amount)
  return Math.round(amount)
}

export interface ForecastingScenario {
  name: string
  description?: string
  // Decimal (0.05 = 5%), -1..1 inclusive; the engine refuses anything else.
  incomeGrowthRate: number
  expenseGrowthRate: number
  // A persistence carrier, not an engine input: carries the builder's rows into saved
  // `scenarioData`. Don't cite as scenario-expressive, and don't delete as dead.
  newIncome?: NormalizableFinancialItem[]
  newExpenses?: NormalizableFinancialItem[]
  // `amount` is SIGNED: positive is money in, negative is money out.
  oneTimeEvents?: Array<{ year: number; amount: number }>
}

export interface YearlyForecast {
  year: number
  income: number
  expenses: number
  netIncome: number
  savings: number
  investments: number
  netWorth: number
  // Projection rows only. `Σ savingsAccounts + unallocatedSavings === savings`, every year.
  savingsAccounts?: number[]
  // Negative when contributions exceed what is left over (they still apply in full).
  unallocatedSavings?: number
  // `netWorth === savings + investments + assets − debts`.
  debts?: number
  balanceAccounts?: number[]
  // Constant every year: an asset does not grow.
  assets?: number
}

export interface ForecastingResult {
  scenario: ForecastingScenario
  baseline: YearlyForecast[]
  projection: YearlyForecast[]
  summary: {
    startingNetWorth: number
    endingNetWorth: number
    totalGrowth: number
    averageAnnualGrowth: number
  }
}

export interface ForecastInputData {
  income: NormalizableFinancialItem[]
  expenses: NormalizableFinancialItem[]
  savings: number
  investments: number
  savingsAccounts?: SavingsAccountInput[]
  balanceAccounts?: BalanceAccountInput[]
  // A CONSTANT: no growth, no contribution. Adds to every year's `netWorth` and nothing else.
  assets?: number
}

function prepareForecastData(data: ForecastInputData): {
  savingsAccounts: SavingsAccountInput[] | undefined
  balanceAccounts: BalanceAccountInput[] | undefined
  balanceAnnualContributions: number[] | undefined
  balanceGrowthMultipliers: number[]
  countedContributionTotal: number
  startingDebts: number
  assets: number | undefined
} {
  // Validated up front, or a NaN here would be misreported as FORECAST_OUT_OF_RANGE.
  validateAmount(data.savings)
  validateAmount(data.investments)
  const assets = data.assets
  if (assets !== undefined) {
    validateAmount(assets)
    if (assets < 0) throw new Error(ASSETS_NEGATIVE)
  }
  const savingsAccounts = data.savingsAccounts
  if (savingsAccounts) {
    let balanceSum = 0
    for (const account of savingsAccounts) {
      validateAmount(account.balance)
      validateAmount(account.monthlyContribution)
      if (account.balance < 0 || account.monthlyContribution < 0) {
        throw new Error(SAVINGS_ROW_NEGATIVE)
      }
      balanceSum += account.balance
    }
    if (balanceSum !== data.savings) {
      throw new Error(SAVINGS_ROWS_MISMATCH)
    }
  }
  // A debt's payment is not a fixed yearly total: it stops at payoff, so each loop takes what
  // the rows paid that year.
  const balanceAccounts = data.balanceAccounts
  let balanceAnnualContributions: number[] | undefined
  const balanceGrowthMultipliers: number[] = []
  let countedContributionTotal = 0
  let startingDebts = 0
  if (balanceAccounts) {
    let investmentSum = 0
    balanceAnnualContributions = balanceAccounts.map((account) => {
      if (account.type !== 'investment' && account.type !== 'debt') {
        throw new Error(BALANCE_ROW_TYPE)
      }
      validateAmount(account.balance)
      validateAmount(account.contribution)
      if (account.balance < 0 || account.contribution < 0) {
        throw new Error(BALANCE_ROW_NEGATIVE)
      }
      if (account.type === 'investment') {
        if (!isValidGrowthRate(account.annualReturn)) {
          throw new Error(INVESTMENT_RETURN_OUT_OF_RANGE)
        }
        balanceGrowthMultipliers.push(1 + account.annualReturn)
      } else {
        balanceGrowthMultipliers.push(1)
      }
      const annual = annualContributionCents({
        monthlyContribution: account.contribution,
        frequency: account.frequency,
      })
      // A finite contribution can annualise to Infinity; a debt would silently floor to 0, so refuse
      // it here for both.
      if (!Number.isFinite(annual)) throw new Error(FORECAST_OUT_OF_RANGE)
      if (account.type === 'investment') {
        investmentSum += account.balance
        if (account.contributionRecordedAsExpense !== true) countedContributionTotal += annual
      } else {
        startingDebts += account.balance
      }
      return annual
    })
    if (investmentSum !== data.investments) {
      throw new Error(BALANCE_ROWS_MISMATCH)
    }
  }
  return {
    savingsAccounts,
    balanceAccounts,
    balanceAnnualContributions,
    balanceGrowthMultipliers,
    countedContributionTotal,
    startingDebts,
    assets,
  }
}

export function calculateFinancialForecast(
  currentData: ForecastInputData,
  scenario: ForecastingScenario,
  years = DEFAULT_FORECAST_YEARS,
  baselineInput?: ForecastInputData
): ForecastingResult {
  // Refuse rather than clamp: a clamp silently projects a period the caller never asked for.
  // Must stay before the first loop.
  if (!isValidForecastYears(years)) {
    throw new Error(
      `Projection period must be a whole number of years from ${MIN_FORECAST_YEARS} to ${MAX_FORECAST_YEARS}`
    )
  }
  // Checked even with no rows: `[].map` never evaluates the rate, so NaN would pass and save as null.
  if (
    !isValidGrowthRate(scenario.incomeGrowthRate) ||
    !isValidGrowthRate(scenario.expenseGrowthRate)
  ) {
    throw new Error(GROWTH_RATE_OUT_OF_RANGE)
  }
  const {
    savingsAccounts,
    balanceAccounts,
    balanceAnnualContributions,
    balanceGrowthMultipliers,
    countedContributionTotal,
    startingDebts,
    assets,
  } = prepareForecastData(currentData)
  const baselineData = baselineInput ?? currentData
  const {
    balanceAccounts: baseBalanceAccounts,
    balanceAnnualContributions: baseBalanceAnnualContributions,
    balanceGrowthMultipliers: baseBalanceGrowthMultipliers,
    countedContributionTotal: baseCountedContributionTotal,
    startingDebts: baseStartingDebts,
    assets: baseAssets,
  } = baselineInput === undefined
    ? {
        balanceAccounts,
        balanceAnnualContributions,
        balanceGrowthMultipliers,
        countedContributionTotal,
        startingDebts,
        assets,
      }
    : prepareForecastData(baselineInput)

  const baseline: YearlyForecast[] = []
  const projection: YearlyForecast[] = []

  let currentSavings = baselineData.savings
  let currentInvestments = baselineData.investments
  // Same `stepBalanceRows` in both loops, so a flat scenario gives baseline === projection.
  let baselineRowBalances = baseBalanceAccounts?.map((account) => account.balance)
  let currentDebts = baseStartingDebts
  const baselineAnnualIncome = calculateTotalAnnualNormalized(baselineData.income || [])
  const baselineAnnualExpenses = calculateTotalAnnualNormalized(baselineData.expenses || [])
  const baselineAnnualNetIncome = baselineAnnualIncome - baselineAnnualExpenses
  // This loop has no running-balance check, so refuse non-finite flows here.
  if (!Number.isFinite(baselineAnnualNetIncome)) throw new Error(FORECAST_OUT_OF_RANGE)

  for (let year = 1; year <= years; year++) {
    // Apply the year's flow BEFORE recording the row, so rows report CLOSING balances. Rows step
    // first (pure on opening balances) because what debts paid comes off this year's net income.
    const baselineStep =
      baseBalanceAccounts && baselineRowBalances && baseBalanceAnnualContributions
        ? stepBalanceRows(
            baseBalanceAccounts,
            baselineRowBalances,
            baseBalanceAnnualContributions,
            baseBalanceGrowthMultipliers
          )
        : null
    const baselineDebtPaid = baselineStep?.countedDebtPaid ?? 0
    const baselineNetIncomeThisYear = baselineAnnualNetIncome - baselineDebtPaid
    currentSavings += baselineNetIncomeThisYear
    if (baseBalanceAccounts && baselineStep) {
      baselineRowBalances = baselineStep.balances
      currentSavings -= baseCountedContributionTotal
      currentInvestments = sumRows(baseBalanceAccounts, baselineRowBalances, 'investment')
      currentDebts = sumRows(baseBalanceAccounts, baselineRowBalances, 'debt')
    } else {
      // Same rate, position and per-year `roundCents` as the projection's `projInvestments`; any
      // drift reopens the baseline/projection divergence.
      currentInvestments = roundCents(currentInvestments * 1.07)
    }

    const baselineYear: YearlyForecast = {
      year,
      income: baselineAnnualIncome,
      expenses: baselineAnnualExpenses + baselineDebtPaid,
      netIncome: baselineNetIncomeThisYear,
      savings: currentSavings,
      investments: currentInvestments,
      netWorth:
        baseAssets === undefined
          ? currentSavings + currentInvestments - currentDebts
          : currentSavings + currentInvestments + baseAssets - currentDebts,
      // Absent (not `undefined`) without rows, so existing `toEqual`s are unchanged.
      ...(baselineRowBalances ? { debts: currentDebts, balanceAccounts: baselineRowBalances } : {}),
      ...(baseAssets === undefined ? {} : { assets: baseAssets }),
    }
    baseline.push(baselineYear)
  }

  let projSavings = currentData.savings
  let projInvestments = currentData.investments
  // Projection loop only: the baseline keeps one savings pot.
  let rowBalances = savingsAccounts?.map((account) => account.balance)
  const annualContributions = savingsAccounts?.map(
    (account) => account.monthlyContribution * MONTHS_PER_YEAR
  )
  const annualContributionTotal = (annualContributions ?? []).reduce((sum, c) => sum + c, 0)
  let unallocatedSavings = 0
  let projRowBalances = balanceAccounts?.map((account) => account.balance)
  let projDebts = startingDebts

  for (let year = 1; year <= years; year++) {
    const adjustedIncome = currentData.income.map((item) => ({
      ...item,
      amount: roundCents(item.amount * (1 + scenario.incomeGrowthRate) ** year),
    }))
    const adjustedExpenses = currentData.expenses.map((item) => ({
      ...item,
      amount: roundCents(item.amount * (1 + scenario.expenseGrowthRate) ** year),
    }))

    // Grow-then-annualise, never the reverse: the grown amount is whole cents, so no second rounding.
    const annualIncome = calculateTotalAnnualNormalized(adjustedIncome)
    const annualExpenses = calculateTotalAnnualNormalized(adjustedExpenses)

    // No `|| 0` on this sum: one NaN event would silently erase every valid event that year.
    const oneTimeForYear = (scenario.oneTimeEvents ?? [])
      .filter((e) => e.year === year)
      .reduce((sum, e) => sum + eventAmountInCents(e.amount), 0)

    // The one-time event is NOT scaled: it is already this year's absolute amount. Debt payments
    // are added after `adjustedExpenses`, so expense growth never applies to them.
    const projStep =
      balanceAccounts && projRowBalances && balanceAnnualContributions
        ? stepBalanceRows(
            balanceAccounts,
            projRowBalances,
            balanceAnnualContributions,
            balanceGrowthMultipliers
          )
        : null
    const projDebtPaid = projStep?.countedDebtPaid ?? 0
    const totalNetIncome = annualIncome - annualExpenses + oneTimeForYear - projDebtPaid

    // Apply this year's flow BEFORE recording the row: rows report END-of-year balances, or a
    // final-year event never lands.
    projSavings += totalNetIncome
    if (balanceAccounts && projStep) {
      projRowBalances = projStep.balances
      projSavings -= countedContributionTotal
      projInvestments = sumRows(balanceAccounts, projRowBalances, 'investment')
      projDebts = sumRows(balanceAccounts, projRowBalances, 'debt')
    } else {
      projInvestments = roundCents(projInvestments * 1.07)
    }
    // Checked on the SUM, so an overflow in either term (Infinity or NaN) is caught: finite
    // values can still sum past MAX_VALUE.
    if (
      !Number.isFinite(projSavings + projInvestments + (assets ?? 0)) ||
      !Number.isFinite(projInvestments) ||
      !Number.isFinite(projDebts)
    ) {
      throw new Error(FORECAST_OUT_OF_RANGE)
    }
    // Contributions apply in full even beyond the year's net income; the remainder goes negative.
    if (rowBalances && annualContributions) {
      rowBalances = rowBalances.map((balance, i) => balance + (annualContributions[i] ?? 0))
      // Keeps rows + remainder === savings.
      unallocatedSavings += totalNetIncome - annualContributionTotal - countedContributionTotal
      if (!Number.isFinite(unallocatedSavings) || !rowBalances.every(Number.isFinite)) {
        throw new Error(FORECAST_OUT_OF_RANGE)
      }
    }

    const yearProjection: YearlyForecast = {
      year,
      income: annualIncome,
      expenses: annualExpenses + projDebtPaid,
      netIncome: totalNetIncome,
      savings: projSavings,
      investments: projInvestments,
      netWorth:
        assets === undefined
          ? projSavings + projInvestments - projDebts
          : projSavings + projInvestments + assets - projDebts,
      // Absent (not `undefined`) without rows, so existing `toEqual`s are unchanged.
      ...(rowBalances ? { savingsAccounts: rowBalances, unallocatedSavings } : {}),
      ...(projRowBalances ? { debts: projDebts, balanceAccounts: projRowBalances } : {}),
      ...(assets === undefined ? {} : { assets }),
    }
    projection.push(yearProjection)
  }

  // Assets count for it, so it matches the Overview's net worth.
  const startingNetWorth =
    assets === undefined
      ? currentData.savings + currentData.investments - startingDebts
      : currentData.savings + currentData.investments + assets - startingDebts
  const lastProjection = projection[projection.length - 1]
  const endingNetWorth = lastProjection ? lastProjection.netWorth : startingNetWorth
  const totalGrowth = endingNetWorth - startingNetWorth
  const averageAnnualGrowth = totalGrowth / years

  return {
    scenario,
    baseline,
    projection,
    summary: {
      startingNetWorth,
      endingNetWorth,
      totalGrowth,
      averageAnnualGrowth,
    },
  }
}

export interface GoalCalculation {
  targetAmount: number
  currentAmount: number
  monthlyContribution: number
  annualReturnRate: number
  yearsToGoal: number
  monthlyAmountNeeded: number
}

export function calculateGoalTimeline(
  targetAmount: number,
  currentAmount: number,
  monthlyContribution: number,
  annualReturnRate: number
): GoalCalculation {
  if (currentAmount >= targetAmount) {
    return {
      targetAmount,
      currentAmount,
      monthlyContribution,
      annualReturnRate,
      yearsToGoal: 0,
      monthlyAmountNeeded: 0,
    }
  }

  let years = 0
  let amount = currentAmount
  const monthlyReturnRate = annualReturnRate / 12

  while (amount < targetAmount && years < 100) {
    years++
    amount = amount * (1 + monthlyReturnRate) + monthlyContribution * 12
  }

  const months = years * 12
  // Approximation: ignores returns rather than solving the annuity formula for PMT.
  const monthlyAmountNeeded = Math.round((targetAmount - currentAmount) / months)

  return {
    targetAmount,
    currentAmount,
    monthlyContribution,
    annualReturnRate,
    yearsToGoal: Math.round(years * 10) / 10,
    monthlyAmountNeeded,
  }
}

export interface SavedScenario {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
}
