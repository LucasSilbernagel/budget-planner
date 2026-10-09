import { projectAccumulatedNestEgg } from '@budget-planner/core/finance/retirement'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders, screen } from '@/test/utils'
import { useCurrencyStore } from '../../stores/currencyStore'
import { RetirementTimelineChart } from '../RetirementTimelineChart'
import { CustomTooltip } from '../RetirementTimelineChart/CustomTooltip'
import {
	getRetirementChartChrome,
	getRetirementMarkerAge,
	getRetirementMarkerOffset,
} from '../RetirementTimelineChart/chart-helpers'

const BASE_PROPS = {
	currentSavedCents: 100_000_00,
	monthlySavingsCents: 1_000_00,
	annualReturnRate: 0.06,
	currentAge: 40,
	yearsToProject: 10,
	earliestRetirementAge: 45,
}

describe('RetirementTimelineChart — controlled child', () => {
	beforeEach(() => {
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	})

	afterEach(() => {
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	})

	it('renders the projection summary from its props', () => {
		renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)
		expect(screen.getByText('Projection Summary:')).toBeInTheDocument()
	})

	it('owns no inputs of its own — every shared field now lives in the planner', () => {
		renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)

		for (const label of [
			'Current Savings',
			'Annual Contribution',
			'Return Rate',
			'Years',
			'Current Age',
			'Retirement Age',
		]) {
			expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
		}
		expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
		expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
		expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
	})

	it('an empty projection replaces only the chart, trapping nobody (AC-9c)', () => {
		const { container } = renderWithProviders(
			<RetirementTimelineChart {...BASE_PROPS} yearsToProject={0} />
		)

		expect(screen.getByTestId('retirement-chart-empty')).toBeInTheDocument()
		expect(container.querySelectorAll('input, select, button')).toHaveLength(0)
	})

	// The expected figure comes from core's monthly-compounded function; the annually compounding
	// `calculateCompoundingProjection` would give a different nest egg.
	it('plots the solver’s own monthly-compounded curve, to the cent', () => {
		renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)

		const expectedCents = projectAccumulatedNestEgg(
			BASE_PROPS.currentSavedCents,
			BASE_PROPS.monthlySavingsCents,
			BASE_PROPS.annualReturnRate,
			BASE_PROPS.yearsToProject * 12
		)
		// Currency-less mode renders plain grouped decimals, so the summary carries the exact figure.
		const expectedDisplay = new Intl.NumberFormat('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(expectedCents / 100)

		const summary = screen.getByText('Projection Summary:').closest('p')
		expect(summary?.textContent).toContain(expectedDisplay)
		expect(expectedDisplay).toBe('345,819.02')
	})

	it('opens the curve at today’s balance, not a year later', () => {
		renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)

		const summary = screen.getByText('Projection Summary:').closest('p')
		expect(summary?.textContent).toContain('at age 40')
		expect(summary?.textContent).toContain('in 10 years')
	})

	it('claims the curve ends at retirement only when it actually does', () => {
		const { unmount } = renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} />)
		expect(screen.getByText('Projection Summary:').closest('p')?.textContent).not.toContain(
			'when you can retire'
		)
		unmount()

		renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} earliestRetirementAge={50} />)
		expect(screen.getByText('Projection Summary:').closest('p')?.textContent).toContain(
			'when you can retire'
		)
	})

	it('says "1 year", not "1 years"', () => {
		renderWithProviders(<RetirementTimelineChart {...BASE_PROPS} yearsToProject={1} />)
		expect(screen.getByText('Projection Summary:').closest('p')?.textContent).toContain(
			'in 1 year,'
		)
	})

	it('reports an overflow instead of throwing out of the render', () => {
		renderWithProviders(
			<RetirementTimelineChart
				{...BASE_PROPS}
				currentSavedCents={Number.MAX_SAFE_INTEGER}
				annualReturnRate={5}
				yearsToProject={100}
			/>
		)

		expect(screen.getByTestId('retirement-chart-empty')).toBeInTheDocument()
		expect(screen.getByText(/too large to chart/)).toBeInTheDocument()
	})
})

// Recharts renders no SVG under jsdom's zero-size container, so the marker decision is a pure
// function tested directly.
describe('getRetirementMarkerOffset', () => {
	it('places the marker at the solver’s derived age, in years from now', () => {
		expect(getRetirementMarkerOffset(62, 40, 30)).toBe(22)
	})

	it('places it at 0 when the plan is already met — the regression this pins', () => {
		// Offset 0 must still yield a marker, or success looks identical to not-reachable.
		expect(getRetirementMarkerOffset(40, 40, 10)).toBe(0)
		expect(getRetirementMarkerOffset(40.3, 40, 10)).toBe(0)
	})

	it('draws no marker when retirement is not reachable', () => {
		expect(getRetirementMarkerOffset(null, 40, 30)).toBeNull()
	})

	it('draws no marker when retirement falls outside the plotted horizon', () => {
		expect(getRetirementMarkerOffset(80, 40, 30)).toBeNull()
	})

	it('rounds month precision onto a whole-year category', () => {
		expect(getRetirementMarkerOffset(62.4, 40, 30)).toBe(22)
		expect(getRetirementMarkerOffset(62.6, 40, 30)).toBe(23)
	})
})

describe('getRetirementChartChrome — narrow vs wide', () => {
	it('drops the axis titles and shrinks the chrome on narrow viewports', () => {
		const narrow = getRetirementChartChrome(true)
		const wide = getRetirementChartChrome(false)

		expect(narrow.showAxisLabels).toBe(false)
		expect(wide.showAxisLabels).toBe(true)

		expect(narrow.height).toBeLessThan(wide.height)
		expect(narrow.yAxisWidth).toBeLessThan(wide.yAxisWidth)
		expect(narrow.tickFontSize).toBeLessThan(wide.tickFontSize)
		expect(narrow.marginRight).toBeLessThan(wide.marginRight)
		expect(narrow.marginLeft).toBeLessThanOrEqual(wide.marginLeft)
	})

	it('keeps all dimensions positive so the chart never collapses', () => {
		for (const chrome of [getRetirementChartChrome(true), getRetirementChartChrome(false)]) {
			expect(chrome.height).toBeGreaterThan(0)
			expect(chrome.yAxisWidth).toBeGreaterThan(0)
			expect(chrome.tickFontSize).toBeGreaterThan(0)
			expect(chrome.marginRight).toBeGreaterThanOrEqual(0)
			expect(chrome.marginLeft).toBeGreaterThanOrEqual(0)
		}
	})

	// The right margin must clear the ~42px "Retirement" label centred on a far-right line,
	// or the label clips at 320px.
	it('narrow branch keeps a usable chart height and a right margin that clears the reference-line label', () => {
		const narrow = getRetirementChartChrome(true)
		expect(narrow.height).toBeGreaterThanOrEqual(240)
		expect(narrow.marginRight).toBeGreaterThanOrEqual(42)
		expect(narrow.tickFontSize).toBeGreaterThanOrEqual(9)
	})
})

// Pin the word and the value together: `toContain('41')` also passes against "Year 41".
describe('CustomTooltip — the header agrees with the axis', () => {
	beforeEach(() => {
		useCurrencyStore.setState({ mode: 'none', currency: 'NONE' })
	})

	function renderTooltip(label: number, overrides: Record<string, unknown> = {}) {
		return renderWithProviders(
			<CustomTooltip
				active
				label={String(label)}
				payload={[
					{
						payload: {
							year: 6,
							age: 41,
							startingBalance: 175_100_00,
							annualContribution: 27_300_00,
							endingBalance: 214_000_00,
							retirementYear: false,
							...overrides,
						},
					},
				]}
			/>
		)
	}

	it('heads the tooltip with the AGE, not the word "Year"', () => {
		const { container } = renderTooltip(41)

		expect(container.textContent).toContain('Age 41')
		expect(container.textContent).not.toContain('Year 41')
	})

	it('also heads the DEGRADED branch with the age (the easily-missed one)', () => {
		const { container } = renderWithProviders(
			<CustomTooltip active label="41" payload={[{ payload: { age: 41 } }]} />
		)

		expect(container.textContent).toContain('Data unavailable')
		expect(container.textContent).toContain('Age 41')
		expect(container.textContent).not.toContain('Year 41')
	})

	it('renders nothing when inactive or empty — unchanged by 44.3', () => {
		const { container } = renderWithProviders(
			<CustomTooltip active={false} label="41" payload={[]} />
		)
		expect(container.textContent).toBe('')
	})
})

describe('getRetirementMarkerAge', () => {
	it('converts the years-from-now offset into the age the axis plots', () => {
		expect(getRetirementMarkerAge(22, 40)).toBe(62)
	})

	it('maps an already-met plan’s offset 0 onto the current age', () => {
		// Offset 0 is a real answer, not "no marker". This proves the conversion, not that a marker renders.
		expect(getRetirementMarkerAge(0, 40)).toBe(40)
	})

	it('draws no marker when there is no offset to convert', () => {
		expect(getRetirementMarkerAge(null, 40)).toBeNull()
	})
})
