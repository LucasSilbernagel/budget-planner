import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SavedForecast } from '../../../routes/forecasting'
import { PencilIcon } from '../../ui/RowActionIcons'
import { ForecastList } from '../forecast-list'

// getByRole names are full-string: rename these labels without updating the absence test and it passes vacuously.

vi.mock('../../../stores/currencyStore', () => ({
	useFormattedAmount: () => (cents: number) => (cents / 100).toFixed(2),
}))

const sampleForecast = {
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
} satisfies SavedForecast

describe('ForecastList reload affordance', () => {
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
		expect(screen.getByRole('button', { name: 'Delete Retirement Plan' })).toBeInTheDocument()
	})

	it('names both row actions after their forecast, not by bare verb', () => {
		render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={vi.fn()} />)

		expect(screen.getByRole('button', { name: 'Edit Retirement Plan' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Delete Retirement Plan' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
		expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
	})

	it('gives each row its own distinct action names', () => {
		const second = { ...sampleForecast, id: 'saved-2', name: 'Sabbatical' } satisfies SavedForecast
		render(
			<ForecastList forecasts={[sampleForecast, second]} onDelete={vi.fn()} onLoad={vi.fn()} />
		)

		for (const name of ['Retirement Plan', 'Sabbatical']) {
			expect(screen.getByRole('button', { name: `Edit ${name}` })).toBeInTheDocument()
			expect(screen.getByRole('button', { name: `Delete ${name}` })).toBeInTheDocument()
		}
	})
})

describe('the Edit action looks and reads like an edit', () => {
	it('draws the finance tables\' pencil, titled "Edit", and nothing still says Load', () => {
		render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={vi.fn()} />)
		const button = screen.getByRole('button', { name: 'Edit Retirement Plan' })
		expect(button).toHaveAttribute('title', 'Edit')

		const { container: reference } = render(<PencilIcon />)
		const pencilPath = reference.querySelector('path')?.getAttribute('d')
		expect(pencilPath, 'PencilIcon rendered a path').toBeTruthy()
		const paths = [...button.querySelectorAll('svg path')].map((p) => p.getAttribute('d'))
		expect(paths).toEqual([pencilPath])
		expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

		expect(screen.queryByRole('button', { name: 'Load Retirement Plan' })).toBeNull()
		expect(screen.queryByTitle('Load')).toBeNull()
	})
})

describe('Total Growth sign', () => {
	const negativeGrowth = {
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
	} satisfies SavedForecast

	it('renders a negative total growth without a "+-" prefix', () => {
		render(<ForecastList forecasts={[negativeGrowth]} onDelete={vi.fn()} onLoad={vi.fn()} />)

		expect(screen.queryByText(/\+-/)).toBeNull()
		expect(screen.getByText('-40000.00')).toBeInTheDocument()
	})

	it('still renders a "+" for positive growth', () => {
		render(<ForecastList forecasts={[sampleForecast]} onDelete={vi.fn()} onLoad={vi.fn()} />)

		expect(screen.getByText('+40000.00')).toBeInTheDocument()
	})
})

describe('secondary text on a selected row', () => {
	it('reads .text-body on the selected row’s blue tint, .text-muted otherwise', () => {
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

describe('row checkbox selects its row', () => {
	// The row's onClick toggles too, so the checkbox's onClick must stop propagation or one click toggles twice.
	const second = { ...sampleForecast, id: 'saved-2', name: 'House Fund' } satisfies SavedForecast

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

describe('selection acts only on visible forecasts', () => {
	const forecast = (id: string, name: string): SavedForecast => ({
		...sampleForecast,
		id,
		name,
		scenario: { ...sampleForecast.scenario, name },
	})
	const alpha = forecast('a', 'Alpha')
	const bravo = forecast('b', 'Bravo')
	const checkbox = (name: string) => screen.getByRole('checkbox', { name })

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

describe('My Forecasts sortable headers', () => {
	function forecastNamed(name: string, createdAt: string, endingNetWorth: number): SavedForecast {
		return {
			...sampleForecast,
			id: `saved-${name}`,
			name,
			result: {
				...sampleForecast.result,
				summary: { ...sampleForecast.result.summary, endingNetWorth },
			},
			createdAt,
			updatedAt: createdAt,
		}
	}
	const FORECASTS = [
		forecastNamed('Alpha', '2026-06-01T00:00:00Z', 50_00),
		forecastNamed('Bravo', '2026-01-01T00:00:00Z', 90_00),
		forecastNamed('Charlie', '2026-03-01T00:00:00Z', 10_00),
	]
	const LABELS = ['Name', 'Created', 'Ending Net Worth'] as const

	function renderList() {
		return render(<ForecastList forecasts={FORECASTS} onDelete={vi.fn()} />)
	}
	function rowOrder(): string[] {
		return screen
			.getAllByRole('row')
			.slice(1)
			.map((row) => FORECASTS.find((f) => row.textContent?.includes(f.name))?.name ?? '?')
	}
	function header(name: (typeof LABELS)[number]): HTMLElement {
		return screen.getByRole('columnheader', { name })
	}
	function sortButton(name: (typeof LABELS)[number]): HTMLElement {
		return within(header(name)).getByRole('button', { name })
	}
	function liveRegion(container: HTMLElement): HTMLElement {
		const region = container.querySelector<HTMLElement>('[aria-live="polite"]')
		if (!region) throw new Error('no live region rendered')
		return region
	}

	it('names each sort button EXACTLY its label: the arrows are aria-hidden but still drawn', () => {
		renderList()
		for (const name of LABELS) {
			const button = sortButton(name)
			const glyph = button.querySelector('span')
			expect(glyph).toHaveAttribute('aria-hidden', 'true')
			expect(glyph?.textContent).toMatch(/^[↕↑↓]$/)
		}
	})

	it('reports the state on each <th> and in each button description', () => {
		renderList()
		expect(header('Created')).toHaveAttribute('aria-sort', 'descending')
		expect(sortButton('Created')).toHaveAccessibleDescription('Sortable column, sorted descending')
		for (const name of ['Name', 'Ending Net Worth'] as const) {
			expect(header(name)).toHaveAttribute('aria-sort', 'none')
			expect(sortButton(name)).toHaveAccessibleDescription('Sortable column, not sorted')
		}
		expect(screen.getByRole('columnheader', { name: 'Description' })).not.toHaveAttribute(
			'aria-sort'
		)
		expect(screen.getByRole('columnheader', { name: 'Actions' })).not.toHaveAttribute('aria-sort')
	})

	it('shows the order the arrow claims: ↓ is newest, largest and Z→A first', async () => {
		const user = userEvent.setup()
		renderList()
		expect(rowOrder()).toEqual(['Alpha', 'Charlie', 'Bravo'])

		await user.click(sortButton('Created'))
		expect(header('Created')).toHaveAttribute('aria-sort', 'ascending')
		expect(rowOrder()).toEqual(['Bravo', 'Charlie', 'Alpha'])

		await user.click(sortButton('Ending Net Worth'))
		expect(header('Ending Net Worth')).toHaveAttribute('aria-sort', 'descending')
		expect(rowOrder()).toEqual(['Bravo', 'Alpha', 'Charlie'])
		await user.click(sortButton('Ending Net Worth'))
		expect(rowOrder()).toEqual(['Charlie', 'Alpha', 'Bravo'])

		await user.click(sortButton('Name'))
		expect(header('Name')).toHaveAttribute('aria-sort', 'descending')
		expect(rowOrder()).toEqual(['Charlie', 'Bravo', 'Alpha'])
	})

	it('announces a header click in a polite live region outside the table', async () => {
		const user = userEvent.setup()
		const { container } = renderList()
		const region = liveRegion(container)
		expect(region).toHaveAttribute('aria-atomic', 'true')
		expect(region.closest('table')).toBeNull()
		expect(region.textContent).toBe('')

		await user.click(sortButton('Created'))
		expect(region.textContent).toBe('Sorted by Created, ascending')
		await user.click(sortButton('Ending Net Worth'))
		expect(region.textContent).toBe('Sorted by Ending Net Worth, descending')
	})

	it('brings the live region back EMPTY when the table returns after a search hid it (code review)', async () => {
		const user = userEvent.setup()
		const { container } = renderList()
		await user.click(sortButton('Created'))
		expect(liveRegion(container).textContent).toBe('Sorted by Created, ascending')

		await user.type(screen.getByRole('searchbox'), 'zzz-no-match')
		expect(container.querySelector('[aria-live="polite"]')).toBeNull()

		await user.clear(screen.getByRole('searchbox'))
		expect(liveRegion(container).textContent).toBe('')
		expect(header('Created')).toHaveAttribute('aria-sort', 'ascending')
	})
})
