import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { PencilIcon } from '../../ui/RowActionIcons'
import { ForecastList } from '../forecast-list'

/**
 * ForecastList reload-affordance tests (story bug-3, AC-4) + the row-action
 * accessible-name contract (deferred-work item closed 2026-09-01).
 *
 * The reopen button only renders when the route passes `onLoad`. Before bug-3 the
 * route never passed it, so saved forecasts could not be reopened. These lock the
 * wiring contract: the action appears and fires when `onLoad` is provided.
 *
 * Story 108.1 (FR176, D7): the action was "Load" with a gear icon; it is now
 * "Edit" with the finance tables' pencil (`PencilIcon`), named `Edit {name}`
 * with `title="Edit"`. Since 97.1 a Save after reopening UPDATES the forecast,
 * so it is an edit. The prop and handler keep their `onLoad` names.
 *
 * ⚠️ THE NAME QUERIES BELOW ARE ROW-DISAMBIGUATED ON PURPOSE, AND THE ABSENCE
 * TEST DEPENDS ON IT. These buttons are icon-only (`PencilIcon`/`DeleteIcon` are
 * both `aria-hidden`), and until 2026-09-01 they carried `title` but NO
 * `aria-label`, so their entire accessible name came from `title` — the weakest
 * source in the accname spec, and un-disambiguated ("Delete", not "Delete
 * <name>") across every row. They now carry `aria-label={`Edit ${name}`}` (`Load ${name}` before 108.1) /
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
  it('renders an Edit action and calls onLoad with the forecast when provided', () => {
    const onLoad = vi.fn()
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={onLoad} />)

    const editButton = screen.getByRole('button', { name: 'Edit Retirement Plan' })
    fireEvent.click(editButton)

    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onLoad).toHaveBeenCalledWith(sampleForecast)
  })

  it('omits the Edit action when onLoad is not provided', () => {
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Edit Retirement Plan' })).toBeNull()
    /* Positive control: the row IS rendered, so the null above is the Edit button
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
    expect(screen.getByRole('button', { name: 'Edit Retirement Plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Retirement Plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
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
      expect(screen.getByRole('button', { name: `Edit ${name}` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Delete ${name}` })).toBeInTheDocument()
    }
  })
})

describe('the Edit action looks and reads like an edit (story 108.1, AC-3)', () => {
  it('draws the finance tables\' pencil, titled "Edit", and nothing still says Load', () => {
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Edit Retirement Plan' })
    expect(button).toHaveAttribute('title', 'Edit')

    // The glyph is the SAME path as `PencilIcon`, read from a fresh render of it
    // rather than a pasted string, so the test cannot drift from the shared icon.
    const { container: reference } = render(<PencilIcon />)
    const pencilPath = reference.querySelector('path')?.getAttribute('d')
    expect(pencilPath, 'PencilIcon rendered a path').toBeTruthy()
    const paths = [...button.querySelectorAll('svg path')].map((p) => p.getAttribute('d'))
    expect(paths).toEqual([pencilPath])
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

    // The old name and tooltip are gone. Positive control: the button above.
    expect(screen.queryByRole('button', { name: 'Load Retirement Plan' })).toBeNull()
    expect(screen.queryByTitle('Load')).toBeNull()
  })
})

describe('Total Growth sign (story forecast-1)', () => {
  /**
   * The `+` prefix on Total Growth used to be hard-coded. That survived only
   * because a negative `totalGrowth` needed expenses to exceed income; once a
   * one-time event could be an OUTFLOW, a single "Money out" row produced one
   * trivially, and `formatCurrency` emits its own `-` — so the cell rendered
   * `+-40,000.00` for exactly the scenario the new Overview copy advertises.
   */
  const negativeGrowth: SavedForecast = {
    ...sampleForecast,
    id: 'saved-negative',
    name: 'House deposit',
    result: {
      ...sampleForecast.result,
      summary: {
        startingNetWorth: 1000000,
        endingNetWorth: -3000000,
        totalGrowth: -4000000,
        averageAnnualGrowth: -400000,
      },
    },
  }

  it('renders a negative total growth without a "+-" prefix', () => {
    render(<ForecastList forecasts={[negativeGrowth]} onDelete={vi.fn()} onLoad={vi.fn()} />)

    // The mocked formatter renders cents/100 with two decimals, so -4000000 is
    // "-40000.00". The bug produced "+-40000.00".
    expect(screen.queryByText(/\+-/)).toBeNull()
    expect(screen.getByText('-40000.00')).toBeInTheDocument()
  })

  it('still renders a "+" for positive growth', () => {
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={vi.fn()} />)

    // Positive control: the guard is conditional, not a blanket removal of the
    // plus sign. Without this, deleting the `+` entirely would pass the test above.
    expect(screen.getByText('+40000.00')).toBeInTheDocument()
  })
})

describe('secondary text on a selected row (story 115.2)', () => {
  it('reads .text-body on the selected row’s blue tint, .text-muted otherwise', () => {
    // gray-500 on the selected row's blue-50 measured 4.44:1, below AA's 4.5:1.
    // Tokens, not paint (jsdom has no Tailwind): the Lighthouse re-run is the proof.
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={vi.fn()} />)
    const lines = () => [screen.getByText('v1'), screen.getByText('+40000.00')]

    for (const line of lines()) expect([...line.classList]).toContain('text-muted')

    const row = screen.getByText('v1').closest('tr') as HTMLElement
    fireEvent.click(row)
    expect([...row.classList]).toContain('bg-blue-50')
    for (const line of lines()) {
      expect([...line.classList]).toContain('text-body')
      expect([...line.classList]).not.toContain('text-muted')
    }
  })
})

describe('row checkbox selects its row (story 118.1, FR186)', () => {
  // Before 118.1 the controlled checkbox's onChange only stopped propagation, so
  // clicking it or pressing Space changed nothing; only a click elsewhere on the
  // row selected it. The row's onClick toggles too, so the box's onClick must
  // keep stopping propagation or one click toggles twice.
  const second: SavedForecast = { ...sampleForecast, id: 'saved-2', name: 'House Fund' }

  it('toggles the row once per click on its checkbox', async () => {
    const user = userEvent.setup()
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} />)
    const box = screen.getByRole('checkbox', { name: 'Select Retirement Plan' })
    const bulk = screen.getByRole('button', { name: 'Delete Selected' })

    await user.click(box)
    expect(box).toBeChecked()
    expect(box.closest('tr')).toHaveClass('bg-blue-50')
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(bulk).toBeEnabled()

    await user.click(box)
    expect(box).not.toBeChecked()
    expect(box.closest('tr')).not.toHaveClass('bg-blue-50')
    expect(screen.queryByText(/selected$/)).toBeNull()
    expect(bulk).toBeDisabled()
  })

  it('toggles the row with Space on its checkbox', async () => {
    const user = userEvent.setup()
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} />)
    const box = screen.getByRole('checkbox', { name: 'Select Retirement Plan' })

    box.focus()
    await user.keyboard(' ')
    expect(box).toBeChecked()
    await user.keyboard(' ')
    expect(box).not.toBeChecked()
  })

  it('bulk-deletes exactly the forecasts checked by their checkboxes', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<ForecastList forecasts={[sampleForecast, second]} onDelete={onDelete} />)

    await user.click(screen.getByRole('checkbox', { name: 'Select House Fund' }))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('saved-2')
    expect(screen.getByRole('checkbox', { name: 'Select House Fund' })).not.toBeChecked()
  })

  it('still selects when the row itself is clicked', async () => {
    const user = userEvent.setup()
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} />)

    await user.click(screen.getByText('Retirement Plan'))
    expect(screen.getByRole('checkbox', { name: 'Select Retirement Plan' })).toBeChecked()
  })

  it("does not select when the row's Delete button is clicked", async () => {
    const user = userEvent.setup()
    render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Delete Retirement Plan' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Retirement Plan' })).not.toBeChecked()
  })
})

describe('selection acts only on visible forecasts (story 119.1, FR187)', () => {
  // Before 119.1 the selection counted every selected id, so a forecast hidden by
  // the search was still counted, still deleted by Delete Selected, and Select all
  // compared counts, not ids. Each forecast gets its own scenario name: the search
  // matches `scenario.name` too, and sampleForecast's would match both.
  const forecast = (id: string, name: string): SavedForecast => ({
    ...sampleForecast,
    id,
    name,
    scenario: { ...sampleForecast.scenario, name },
  })
  const alpha = forecast('a', 'Alpha')
  const bravo = forecast('b', 'Bravo')
  const checkbox = (name: string) => screen.getByRole('checkbox', { name })

  // Owns the list like the page does: a delete drops the forecast from it.
  function Harness({ initial }: { initial: SavedForecast[] }) {
    const [list, setList] = useState(initial)
    return (
      <ForecastList
        forecasts={list}
        onDelete={(id) => setList((prev) => prev.filter((f) => f.id !== id))}
      />
    )
  }

  it('deletes only the visible selection, never a forecast hidden by the search', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<ForecastList forecasts={[alpha, bravo]} onDelete={onDelete} />)

    await user.click(checkbox('Select Alpha'))
    await user.type(screen.getByRole('searchbox'), 'Bravo')
    await user.click(checkbox('Select Bravo'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('delete 1 selected forecast(s)?')
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('b')
    // Still rendered (onDelete is a mock), but no longer selected (D1, review P1).
    expect(checkbox('Select Bravo')).not.toBeChecked()
    expect(screen.queryByText(/selected$/)).toBeNull()
  })

  it('offers no bulk delete when every selected forecast is hidden', async () => {
    const user = userEvent.setup()
    render(<ForecastList forecasts={[alpha, bravo]} onDelete={vi.fn()} />)
    const bulk = screen.getByRole('button', { name: 'Delete Selected' })

    await user.click(checkbox('Select Alpha'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
    expect(bulk).toBeEnabled()

    await user.type(screen.getByRole('searchbox'), 'Bravo')
    expect(screen.queryByText(/selected$/)).toBeNull()
    expect(bulk).toBeDisabled()
  })

  it('checks Select all only when every visible row is selected, and leaves hidden ones alone', async () => {
    const user = userEvent.setup()
    render(<ForecastList forecasts={[alpha, bravo]} onDelete={vi.fn()} />)

    await user.click(checkbox('Select Alpha'))
    await user.type(screen.getByRole('searchbox'), 'Bravo')
    expect(checkbox('Select all')).not.toBeChecked()

    await user.click(checkbox('Select all'))
    expect(checkbox('Select Bravo')).toBeChecked()
    expect(checkbox('Select all')).toBeChecked()
    await user.click(checkbox('Select all'))
    expect(checkbox('Select Bravo')).not.toBeChecked()

    await user.clear(screen.getByRole('searchbox'))
    expect(checkbox('Select Alpha')).toBeChecked()
  })

  it('keeps a hidden selection through a bulk delete and shows it when the search is cleared', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[alpha, bravo]} />)

    await user.click(checkbox('Select Alpha'))
    await user.type(screen.getByRole('searchbox'), 'Bravo')
    await user.click(checkbox('Select Bravo'))
    await user.click(screen.getByRole('button', { name: 'Delete Selected' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )
    expect(screen.queryByRole('checkbox', { name: 'Select Bravo' })).toBeNull()

    await user.clear(screen.getByRole('searchbox'))
    expect(checkbox('Select Alpha')).toBeChecked()
    expect(checkbox('Select Alpha').closest('tr')).toHaveClass('bg-blue-50')
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('stops counting a selected forecast once it leaves the list', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ForecastList forecasts={[alpha, bravo]} onDelete={vi.fn()} />)

    await user.click(checkbox('Select Alpha'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    rerender(<ForecastList forecasts={[bravo]} onDelete={vi.fn()} />)
    expect(screen.queryByText(/selected$/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeDisabled()
    expect(checkbox('Select all')).not.toBeChecked()
    expect(checkbox('Select Bravo')).not.toBeChecked()
  })

  it('adds the visible rows to the selection with Select all instead of replacing it', async () => {
    const user = userEvent.setup()
    render(<ForecastList forecasts={[alpha, bravo]} onDelete={vi.fn()} />)

    await user.click(checkbox('Select Alpha'))
    await user.type(screen.getByRole('searchbox'), 'Bravo')
    await user.click(checkbox('Select all'))
    expect(checkbox('Select Bravo')).toBeChecked()

    await user.clear(screen.getByRole('searchbox'))
    expect(checkbox('Select Alpha')).toBeChecked()
    expect(checkbox('Select Bravo')).toBeChecked()
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })
})
