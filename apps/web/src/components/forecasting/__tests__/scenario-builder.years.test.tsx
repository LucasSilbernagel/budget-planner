import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { useIncomeStore } from '../../../stores/incomeStore'
import { useProfileStore } from '../../../stores/profileStore'
import { ScenarioBuilder } from '../scenario-builder'

/**
 * The Projection Period field and one-time event amounts never reach the engine
 * out of range (story 77.1, FR124).
 *
 * ⚠️⚠️ THE ENGINE IS MOCKED, and it has to be. Before this story a `years` of 1e9
 * typed into the field reached `calculateFinancialForecast`, whose loop is
 * synchronous: on a build without the guard the REAL engine would hang this test
 * run rather than fail it (a sync loop blocks vitest's own timeout). The fake
 * records every call and runs the real engine with the SAME inputs, substituting
 * only a `years` it cannot finish. Events are passed through untouched (77.1
 * code review, P5): stripping them made the engine's event validation invisible
 * here, so a "no calculation error" assertion could not fail.
 * Every assertion about the guard is on that RECORD, not on what is on screen:
 * the summary tile already masks a NaN with `|| 0`, so "no NaN on screen" would
 * be green without any guard at all.
 *
 * The in-range rule is written out as a plain integer check here, not imported
 * from core, so the test states the rule independently of the code under test.
 */

type EngineCall = { years: unknown; events: Array<{ year: number; amount: number }> }
const engineCalls = vi.hoisted(() => [] as EngineCall[])

vi.mock('@budget-planner/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@budget-planner/core')>()
  return {
    ...real,
    calculateFinancialForecast: (
      data: Parameters<typeof real.calculateFinancialForecast>[0],
      scenario: Parameters<typeof real.calculateFinancialForecast>[1],
      years: number
    ) => {
      engineCalls.push({ years, events: scenario.oneTimeEvents ?? [] })
      const finishable = Number.isInteger(years) && years >= 1 && years <= 30
      return real.calculateFinancialForecast(data, scenario, finishable ? years : 1)
    },
  }
})

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
  useCurrencyPreferences: () => ({ mode: 'none', currency: 'NONE', locale: 'en-US' }),
  useCurrencyMode: () => 'none',
  useCurrencyCode: () => 'NONE',
}))

const ISO = '2026-09-28T00:00:00.000Z'
const PROFILE = 'profile-test'
const YEARS_LABEL = 'Projection Period (years)'
const MESSAGE = 'Enter a whole number of years from 1 to 30.'
const SAVE_REASON = 'Fix the projection period to save'
/** Comfortably past the builder's 500 ms debounce. */
const PAST_DEBOUNCE_MS = 700

const inRange = (y: unknown) => Number.isInteger(y) && (y as number) >= 1 && (y as number) <= 30

async function pastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS))
  })
}

/** The figure a Forecast Summary stat card shows, read through its `<dt>` label. */
function statValue(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' })
  return term.nextElementSibling?.textContent ?? ''
}

/** Renders a fresh builder and waits for its first (default, 10-year) computation. */
async function renderBuilder(initialForecast?: SavedForecast): Promise<HTMLInputElement> {
  render(<ScenarioBuilder onSave={vi.fn()} initialForecast={initialForecast} />)
  await waitFor(() => expect(engineCalls.length).toBeGreaterThan(0), { timeout: 3000 })
  return screen.getByLabelText(YEARS_LABEL) as HTMLInputElement
}

beforeEach(() => {
  engineCalls.length = 0
  useProfileStore.setState({ activeProfileId: PROFILE })
  useIncomeStore.setState({
    incomeSources: [
      {
        id: 'inc-1',
        profileId: PROFILE,
        userId: 0,
        name: 'Salary',
        amount: 500_000,
        frequency: 'monthly',
        categoryId: null,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
  })
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  vi.clearAllMocks()
})

describe('the Projection Period field refuses what the engine cannot run (AC-1)', () => {
  const invalid: [string, string][] = [
    ["an empty field (Number('') is 0)", ''],
    ['0', '0'],
    ['-3', '-3'],
    ['2.5', '2.5'],
    ['31', '31'],
    ['1e9 (a finite value that froze the tab)', '1e9'],
    // ⚠️ jsdom sanitizes an out-of-range number to "" — and so does Chromium,
    // MEASURED in 77.1 (`value=""`, `badInput=true`) — so this case exercises
    // the same path as the empty field. It is kept by NAME because the epic
    // named it, and because a UA that delivered "1e999" raw would hand the
    // builder Infinity.
    ['1e999', '1e999'],
  ]

  for (const [label, typed] of invalid) {
    it(`${label}: no engine call, an explained message, Save blocked`, async () => {
      const field = await renderBuilder()
      expect(engineCalls.at(-1)?.years, 'first computation is the default').toBe(10)
      const callsBefore = engineCalls.length

      const endingBefore = statValue('Ending Net Worth')
      fireEvent.change(field, { target: { value: typed } })
      await pastDebounce()

      expect(
        engineCalls.map((c) => c.years).filter((y) => !inRange(y)),
        'every years the engine was called with must be a whole number 1-30'
      ).toEqual([])
      expect(engineCalls.length, 'no recompute for an invalid period').toBe(callsBefore)
      // AC-1: the last VALID result stays on screen (not blanked, not zeroed).
      expect(statValue('Ending Net Worth'), 'last valid result kept').toBe(endingBefore)
      expect(endingBefore).not.toBe('0.00')

      const message = screen.getByText(MESSAGE)
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(field.getAttribute('aria-describedby')).toBe(message.id)

      expect(screen.getByTestId('save-blocked-reason')).toHaveTextContent(SAVE_REASON)
      expect(screen.getByRole('button', { name: /save forecast/i })).toBeDisabled()
    })
  }

  it('a valid period clears the message, re-enables Save and recomputes with it', async () => {
    const field = await renderBuilder()
    fireEvent.change(field, { target: { value: '1e9' } })
    await pastDebounce()
    expect(screen.getByText(MESSAGE)).toBeInTheDocument()

    fireEvent.change(field, { target: { value: '12' } })
    await waitFor(() => expect(engineCalls.at(-1)?.years).toBe(12), { timeout: 3000 })

    expect(screen.queryByText(MESSAGE)).toBeNull()
    expect(field).not.toHaveAttribute('aria-invalid')
    expect(field).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByTestId('save-blocked-reason')).toBeNull()
    expect(screen.getByRole('button', { name: /save forecast/i })).toBeEnabled()
  })

  it('an invalid period retires a stale calculation error (review P3)', async () => {
    // A banner from an input no field can refuse: an income amount of 1e308 cents
    // (finite), which annualized overflows, so the engine refuses with
    // FORECAST_OUT_OF_RANGE.
    // ⚠️ This used an EMPTIED growth rate until story 81.1. That now shows a
    // field message and never reaches the engine, so it raises no banner at all.
    // Until story 109.1 the amount was TYPED (`1e306`); the field now refuses
    // anything above the money limit, so it arrives from a saved forecast.
    const field = await renderBuilder({
      id: 'f-big',
      name: 'Big',
      scenario: {
        name: 'Big',
        incomeGrowthRate: 0,
        expenseGrowthRate: 0,
        newIncome: [{ amount: 1e308, frequency: 'monthly' }],
      },
      result: {
        scenario: { name: 'Big', incomeGrowthRate: 0, expenseGrowthRate: 0 },
        baseline: [],
        projection: [],
        summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
      },
      inputs: { savings: 0, investments: 0, years: 10 },
      createdAt: ISO,
      updatedAt: ISO,
    })
    expect(
      await screen.findByTestId('calculation-error', {}, { timeout: 3000 })
    ).toBeInTheDocument()

    fireEvent.change(field, { target: { value: '31' } })
    await pastDebounce()

    expect(
      screen.queryByTestId('calculation-error'),
      'a banner about inputs that have since changed must not stay up'
    ).toBeNull()
  })

  it('event rows clamp their year against the LAST VALID period, not the typed one', async () => {
    const field = await renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add event/i }))
    const eventYear = document.querySelector('input[id^="event-year-"]') as HTMLInputElement
    expect(eventYear, 'the new event row rendered').not.toBeNull()

    // While 1e9 sits in the field, the event year must still be capped at the
    // period the builder can actually project (10, the last valid one).
    fireEvent.change(field, { target: { value: '1e9' } })
    fireEvent.change(eventYear, { target: { value: '25' } })
    fireEvent.change(field, { target: { value: '30' } })
    await waitFor(() => expect(engineCalls.at(-1)?.years).toBe(30), { timeout: 3000 })

    expect(engineCalls.at(-1)?.events.map((e) => e.year)).toEqual([10])
  })

  it('the other fields carry no aria-invalid / aria-describedby (InputField stays byte-identical)', async () => {
    await renderBuilder()
    for (const label of ['Scenario Name', 'Description', 'Income Growth Rate']) {
      const input = screen.getByLabelText(label)
      expect(input, label).not.toHaveAttribute('aria-invalid')
      expect(input, label).not.toHaveAttribute('aria-describedby')
    }
  })
})

describe('one-time event amounts reach the engine finite and in whole cents (AC-4)', () => {
  it('an amount that overflows to Infinity once scaled to cents never reaches the engine', async () => {
    const field = await renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: /add event/i }))
    // Income rows are labelled "Amount" too; the event's input has its own id prefix.
    const amount = document.querySelector('input[id^="event-amount-"]') as HTMLInputElement
    expect(amount, 'the new event row rendered').not.toBeNull()

    fireEvent.change(amount, { target: { value: '12.34' } })
    await waitFor(() => expect(engineCalls.at(-1)?.events.map((e) => e.amount)).toEqual([1234]), {
      timeout: 3000,
    })
    // `1e308` is a finite number the input accepts; `* 100` makes it Infinity.
    fireEvent.change(amount, { target: { value: '1e308' } })
    // ⚠️ Retitled by 81.1's code review (P1). Until 81.1 this test forced a
    // recompute through the period field to show the STORED amount was still 1234
    // ("is not stored"). Since 81.1 an invalid field HOLDS every recompute (D4,
    // confirmed by Lucas; it overrides AC-2's "unmodified" wording for this test),
    // so the stored amount is no longer observable while the field is invalid.
    // What the record CAN show is the claim that matters: nothing non-finite ever
    // reaches the engine, even when another field changes. The field's own message
    // is pinned in `scenario-builder.fields.test.tsx`.
    fireEvent.change(field, { target: { value: '11' } })
    await pastDebounce()

    expect(
      engineCalls.flatMap((c) => c.events.map((e) => e.amount)).filter((a) => !Number.isFinite(a)),
      'no engine call may carry a non-finite event amount'
    ).toEqual([])
  })

  it('a saved event amount of null (a JSON-flattened NaN/Infinity) or a fraction loads usable', async () => {
    const saved: SavedForecast = {
      id: 'f-1',
      name: 'Plan',
      scenario: {
        name: 'Plan',
        incomeGrowthRate: 0,
        expenseGrowthRate: 0,
        oneTimeEvents: [
          { year: 1, amount: null as unknown as number },
          { year: 2, amount: 0.5 },
        ],
      },
      result: {
        scenario: { name: 'Plan', incomeGrowthRate: 0, expenseGrowthRate: 0 },
        baseline: [],
        projection: [],
        summary: { startingNetWorth: 0, endingNetWorth: 0, totalGrowth: 0, averageAnnualGrowth: 0 },
      },
      inputs: { savings: 0, investments: 0, years: 5 },
      createdAt: ISO,
      updatedAt: ISO,
    }
    await renderBuilder(saved)

    expect(engineCalls.at(-1)?.years).toBe(5)
    expect(engineCalls.at(-1)?.events.map((e) => e.amount)).toEqual([0, 1])
    expect(screen.queryByTestId('calculation-error')).toBeNull()
  })
})
