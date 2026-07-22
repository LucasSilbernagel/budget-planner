import {
  type RetirementAccumulationResult,
  type RetirementModel,
  solveRetirementAccumulation,
} from '@budget-planner/core/finance/retirement'
import {
  currencySymbol,
  formatCurrency,
  formatForInputDisplay,
  parseFromInput,
} from '@budget-planner/core/format/currency'
import React, { useEffect, useMemo, useState } from 'react'
import { useTotalInvestmentBalance } from '../stores/balanceStore'
import { useCurrencyPreferences } from '../stores/currencyStore'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * Parse a currency string to integer cents (strict).
 *
 * Mirrors RetirementForm.parseCurrencyToCents so the two retirement surfaces
 * parse money identically: locale-canonicalizes grouping/decimal separators,
 * then rejects negative, multi-decimal, scientific-notation, non-numeric, or
 * overflowing values. An empty string parses to 0 (the caller decides whether an
 * empty field means "not provided yet").
 *
 * @throws Error on malformed input.
 */
function parseCurrencyToCents(value: string, locale?: string): number {
  if (value == null) {
    throw new Error('Invalid currency: value cannot be null or undefined')
  }

  if (value.trim() === '') {
    return 0
  }

  let trimmed = value.trim()

  // Canonicalize locale grouping/decimal to en-US form BEFORE stripping so a
  // grouped/comma-decimal input (e.g. de-DE "1.234,56") parses to the right cents
  // instead of being corrupted by the '.'-as-decimal assumption below.
  if (locale) {
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(11111.1)
      const groupSep = parts.find((p) => p.type === 'group')?.value
      const decimalSep = parts.find((p) => p.type === 'decimal')?.value
      if (groupSep) trimmed = trimmed.split(groupSep).join('')
      if (decimalSep && decimalSep !== '.') trimmed = trimmed.split(decimalSep).join('.')
    } catch {
      // Invalid/exotic locale: fall through with the raw value (en-US assumptions).
    }
  }

  if (trimmed.startsWith('-')) {
    throw new Error('Currency amount cannot be negative')
  }

  const cleaned = trimmed.replace(/[^\d.]/g, '')

  if ((cleaned.match(/\./g) || []).length > 1) {
    throw new Error('Invalid currency: multiple decimal points not allowed')
  }

  if (cleaned.includes('e') || cleaned.includes('E')) {
    throw new Error('Invalid currency: scientific notation not allowed')
  }

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('Invalid currency: contains non-numeric characters')
  }

  const amount = parseFloat(cleaned)

  if (Number.isNaN(amount) || !Number.isFinite(amount)) {
    throw new Error('Invalid currency: must be a valid finite number')
  }

  const cents = Math.round(amount * 100)

  if (!Number.isSafeInteger(cents)) {
    throw new Error('Invalid currency: value exceeds safe integer limit')
  }

  return cents
}

/**
 * Parse a percentage string to a decimal (strict). "6" / "6%" / "6.5" → 0.06 /
 * 0.065. Empty string → 0. Mirrors RetirementForm.parsePercentageToDecimal.
 *
 * @throws Error on malformed or negative input.
 */
function parsePercentageToDecimal(value: string): number {
  if (value == null) {
    throw new Error('Invalid percentage: value cannot be null or undefined')
  }

  if (value.trim() === '') {
    return 0
  }

  const trimmed = value.trim()

  if ((trimmed.match(/\./g) || []).length > 1) {
    throw new Error('Invalid percentage: multiple decimal points not allowed')
  }

  if (trimmed.startsWith('-')) {
    throw new Error('Percentage cannot be negative')
  }

  if (trimmed.includes('e') || trimmed.includes('E')) {
    throw new Error('Invalid percentage: scientific notation not allowed')
  }

  const cleaned = trimmed.replace(/%/g, '').trim()

  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error('Invalid percentage: contains non-numeric characters')
  }

  const num = parseFloat(cleaned)

  if (Number.isNaN(num) || !Number.isFinite(num)) {
    throw new Error('Invalid percentage: must be a valid finite number')
  }

  return num / 100
}

/**
 * Parse a whole-number age (years). Empty string → null ("not provided").
 *
 * @throws Error on non-numeric, negative, or non-integer input.
 */
function parseAge(value: string): number | null {
  if (value == null || value.trim() === '') {
    return null
  }

  const trimmed = value.trim()

  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Age must be a whole number')
  }

  const num = parseInt(trimmed, 10)

  if (!Number.isFinite(num)) {
    throw new Error('Age must be a finite number')
  }

  return num
}

/** The parsed, ready-to-solve input set, or a reason it is not solvable yet. */
type ParsedInputs =
  | { ok: true; input: Parameters<typeof solveRetirementAccumulation>[0] }
  | { ok: false; reason: 'incomplete' | 'invalid' }

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
  | { status: 'failed' }
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
 * RetirementAccumulationPlanner
 *
 * Unified retirement accumulation planner (Story 26.7 / FR42). Collects the
 * user's plan (age, current savings, monthly savings, return, desired annual
 * income, life expectancy), runs the shipped core solver
 * `solveRetirementAccumulation`, and shows the spreadsheet's output set — with a
 * toggle between the deplete-to-life-expectancy and perpetual safe-withdrawal
 * target models. Free-tier: all math runs client-side in core.
 *
 * The solver throws on non-finite/negative inputs, so inputs are strictly parsed
 * and guarded before it is ever called; a `reachable: false` result (no feasible
 * retirement before life expectancy) is rendered as a calm, actionable state
 * rather than an error.
 */
function RetirementAccumulationPlannerInner() {
  const { mode, currency, locale } = useCurrencyPreferences()
  const totalInvestmentCents = useTotalInvestmentBalance()

  // Pre-fill current-saved from the shared `useTotalInvestmentBalance` selector
  // (the same figure that drives the 26.5 "Total Investments" card — one source
  // of truth). That selector sums raw `currentBalance` without clamping, so for a
  // mixed portfolio this seeds the NET investment balance (and a non-positive net
  // seeds an empty, editable field). This differs from RetirementForm, which uses
  // its own locally-clamped reduce; the field is editable either way.
  const prefillCurrentSaved = useMemo(
    () => (totalInvestmentCents > 0 ? formatForInputDisplay(totalInvestmentCents, locale) : ''),
    [totalInvestmentCents, locale]
  )

  const [currentAgeInput, setCurrentAgeInput] = useState<string>('')
  const [currentSavedInput, setCurrentSavedInput] = useState<string>(prefillCurrentSaved)
  const [monthlySavingsInput, setMonthlySavingsInput] = useState<string>('')
  const [annualReturnInput, setAnnualReturnInput] = useState<string>('6.0')
  const [desiredAnnualIncomeInput, setDesiredAnnualIncomeInput] = useState<string>('')
  const [lifeExpectancyInput, setLifeExpectancyInput] = useState<string>('')
  const [model, setModel] = useState<RetirementModel>('deplete')

  // Re-seed current-saved when the investment total changes (mirrors
  // RetirementForm's prefill effect). Only overwrites with a non-empty prefill so
  // it never blanks a value the user is editing before any accounts exist.
  useEffect(() => {
    if (prefillCurrentSaved !== '') {
      // Functional-equality bailout: on mount `useState` already seeded this
      // value, so returning `prev` unchanged avoids a redundant re-render (and
      // the act() churn it causes in tests) — it only updates on a real change.
      setCurrentSavedInput((prev) => (prev === prefillCurrentSaved ? prev : prefillCurrentSaved))
    }
  }, [prefillCurrentSaved])

  // Re-echo a currency field in grouped, locale-aware form on blur. Uses the
  // non-throwing core parser so it can never throw inside the state updater; a
  // typo with no digits is left as typed so it stays visible.
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
      const anyMoneyEmpty =
        currentSavedInput.trim() === '' ||
        monthlySavingsInput.trim() === '' ||
        desiredAnnualIncomeInput.trim() === ''
      const anyRateEmpty = annualReturnInput.trim() === ''

      if (currentAge === null || lifeExpectancy === null || anyMoneyEmpty || anyRateEmpty) {
        return { ok: false, reason: 'incomplete' }
      }

      return {
        ok: true,
        input: {
          currentAge,
          currentSavedCents: parseCurrencyToCents(currentSavedInput, locale),
          monthlySavingsCents: parseCurrencyToCents(monthlySavingsInput, locale),
          annualReturnRate: parsePercentageToDecimal(annualReturnInput),
          desiredAnnualIncomeCents: parseCurrencyToCents(desiredAnnualIncomeInput, locale),
          lifeExpectancy,
          model,
        },
      }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }, [
    currentAgeInput,
    currentSavedInput,
    monthlySavingsInput,
    annualReturnInput,
    desiredAnnualIncomeInput,
    lifeExpectancyInput,
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
    } catch {
      return { status: 'failed' }
    }
  }, [parsed])

  const formatAmount = (cents: number): string => formatCurrency(cents, { mode, currency, locale })

  const inputClass = (withSymbol: boolean) =>
    `w-full py-3 ${
      mode === 'symbol' && withSymbol ? 'pl-10 pr-4' : 'px-4'
    } border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors`

  // A currency text input with the shared symbol-prefix + grouped-echo behavior.
  // A plain render helper (called, not mounted as a `<Component/>`) so the inputs
  // keep a stable identity across renders and never lose focus mid-typing.
  const currencyField = ({
    id,
    label,
    help,
    value,
    onChange,
  }: {
    id: string
    label: string
    help: string
    value: string
    onChange: React.Dispatch<React.SetStateAction<string>>
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
          onChange={(e) => onChange(e.target.value)}
          onBlur={reEcho(onChange)}
          inputMode="decimal"
          placeholder="0.00"
          className={inputClass(true)}
          aria-label={label}
        />
      </div>
      <p className="text-sm text-muted mt-1">{help}</p>
    </div>
  )

  return (
    <div className="space-y-8">
      {/* Inputs */}
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
          />
          <p className="text-sm text-muted mt-1">The age you plan through</p>
        </div>

        {currencyField({
          id: 'currentSaved',
          label: 'Current Amount Saved',
          help: 'Pre-filled from your investment accounts — edit if needed',
          value: currentSavedInput,
          onChange: setCurrentSavedInput,
        })}

        {currencyField({
          id: 'monthlySavings',
          label: 'Monthly Savings',
          help: 'How much you add to savings each month',
          value: monthlySavingsInput,
          onChange: setMonthlySavingsInput,
        })}

        {currencyField({
          id: 'desiredAnnualIncome',
          label: 'Desired Annual Retirement Income',
          help: 'The yearly income you want in retirement',
          value: desiredAnnualIncomeInput,
          onChange: setDesiredAnnualIncomeInput,
        })}

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
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
              %
            </span>
          </div>
          <p className="text-sm text-muted mt-1">Expected yearly return on investments</p>
        </div>
      </div>

      {/* Model toggle */}
      <fieldset className="p-4 surface-inset rounded-lg">
        <legend className="text-sm font-medium text-label px-1">Retirement target model</legend>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(
            Object.entries(MODEL_COPY) as [
              RetirementModel,
              { label: string; explanation: string },
            ][]
          ).map(([key, copy]) => (
            <label
              key={key}
              className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
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
                className="mt-1 focus:ring-2 focus:ring-blue-500"
              />
              <span>
                <span className="block font-medium text-subheading">{copy.label}</span>
                <span className="block text-sm text-muted mt-1">{copy.explanation}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Results */}
      {!parsed.ok && (
        <div className="p-4 surface-inset rounded-lg text-body" role="status">
          {parsed.reason === 'invalid'
            ? 'Please check your inputs — one of the values is not a valid number.'
            : 'Enter all six details above to see your retirement outlook.'}
        </div>
      )}

      {solved?.status === 'failed' && (
        <div
          data-testid="accumulation-solve-failed"
          className="p-4 surface-inset rounded-lg text-body"
          role="status"
        >
          Those numbers are too large to compute. Please check your inputs — a value like age or
          life expectancy looks out of range.
        </div>
      )}

      {solved?.status === 'solved' && solved.result.reachable && (
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
          </dl>
          <p className="text-sm text-green-700 dark:text-green-300 mt-4">
            {MODEL_COPY[model]?.explanation}
          </p>
        </div>
      )}

      {solved?.status === 'solved' && !solved.result.reachable && (
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
              <ul className="list-disc pl-5 mt-3 text-sm space-y-1">
                <li>Save more each month</li>
                <li>Retire on a lower annual income</li>
                <li>Assume a higher annual return</li>
                <li>Extend your life-expectancy horizon</li>
              </ul>
            </>
          )}
        </div>
      )}
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
