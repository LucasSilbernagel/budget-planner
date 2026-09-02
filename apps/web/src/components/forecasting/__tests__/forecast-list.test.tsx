import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { ForecastList } from '../forecast-list'

/**
 * ForecastList reload-affordance tests (story bug-3, AC-4) + the row-action
 * accessible-name contract (deferred-work item closed 2026-09-01).
 *
 * The Load button only renders when the route passes `onLoad`. Before bug-3 the
 * route never passed it, so saved forecasts could not be reopened. These lock the
 * wiring contract: the Load action appears and fires when `onLoad` is provided.
 *
 * ⚠️ THE NAME QUERIES BELOW ARE ROW-DISAMBIGUATED ON PURPOSE, AND THE ABSENCE
 * TEST DEPENDS ON IT. These buttons are icon-only (`LoadIcon`/`DeleteIcon` are
 * both `aria-hidden`), and until 2026-09-01 they carried `title` but NO
 * `aria-label`, so their entire accessible name came from `title` — the weakest
 * source in the accname spec, and un-disambiguated ("Delete", not "Delete
 * <name>") across every row. They now carry `aria-label={`Load ${name}`}` /
 * `Delete ${name}`; `title` is kept for the pointer tooltip only.
 *
 * ⚠️ `getByRole`'s `name` is a FULL-STRING match, so a query written against the
 * OLD bare name ('Load') now matches nothing — which makes a `queryByRole(...)
 * toBeNull()` absence assertion pass instantly whether or not the button
 * rendered. That is the same silent-green shape story 43.1 warned about and 51.1
 * hit again. Any future rename of these labels MUST be carried into the absence
 * test at the same time, or it stops proving anything.
 */

vi.mock('../../../stores/currencyStore', () => ({
  useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
}))

const sampleForecast: SavedForecast = {
  id: 'saved-1',
  name: 'Retirement Plan',
  scenario: {
    name: 'Retirement Plan',
    incomeGrowthRate: 0.03,
    expenseGrowthRate: 0.02,
  },
  result: {
    scenario: { name: 'Retirement Plan', incomeGrowthRate: 0.03, expenseGrowthRate: 0.02 },
    baseline: [],
    projection: [],
    summary: {
      startingNetWorth: 1000000,
      endingNetWorth: 5000000,
      totalGrowth: 4000000,
      averageAnnualGrowth: 400000,
    },
  },
  inputs: { savings: 500000, investments: 1000000, years: 10 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('ForecastList reload affordance (bug-3 AC-4)', () => {
  it('renders a Load action and calls onLoad with the forecast when provided', () => {
    const onLoad = vi.fn()
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={onLoad} />)

    const loadButton = screen.getByRole('button', { name: 'Load Retirement Plan' })
    fireEvent.click(loadButton)

    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onLoad).toHaveBeenCalledWith(sampleForecast)
  })

  it('omits the Load action when onLoad is not provided', () => {
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Load Retirement Plan' })).toBeNull()
    /* Positive control: the row IS rendered, so the null above is the Load button
     * genuinely absent and not the whole list failing to mount. Without this the
     * assertion passes on an empty render. */
    expect(screen.getByRole('button', { name: 'Delete Retirement Plan' })).toBeInTheDocument()
  })

  it('names both row actions after their forecast, not by bare verb', () => {
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={vi.fn()} />)

    /* Row-disambiguated: two forecasts must not both expose a button named
     * "Delete". Asserting the bare verb is ABSENT is what makes this falsifiable
     * — dropping either `aria-label` reverts the name to `title`'s bare verb and
     * reddens both halves. */
    expect(screen.getByRole('button', { name: 'Load Retirement Plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Retirement Plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('gives each row its own distinct action names', () => {
    const second: SavedForecast = { ...sampleForecast, id: 'saved-2', name: 'Sabbatical' }
    render(
      <ForecastList forecasts={[sampleForecast, second]} onDelete={vi.fn()} onLoad={vi.fn()} />
    )

    /* The defect this closes: with names sourced from `title`, every row's Delete
     * button was called "Delete", so a screen-reader user tabbing the list could
     * not tell which forecast they were about to destroy. */
    for (const name of ['Retirement Plan', 'Sabbatical']) {
      expect(screen.getByRole('button', { name: `Load ${name}` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Delete ${name}` })).toBeInTheDocument()
    }
  })
})
