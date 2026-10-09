import { usePrefersDarkScheme } from '../hooks/usePrefersDarkScheme'

/** Recharts' default strokes and fills are only legible on a light canvas. */
export type ChartColors = {
	axis: string
	grid: string
	tooltipBg: string
	tooltipBorder: string
	tooltipText: string
}

const LIGHT_CHART_COLORS: ChartColors = {
	axis: '#6b7280', // gray-500
	grid: '#e5e7eb', // gray-200
	tooltipBg: '#ffffff',
	tooltipBorder: '#e5e7eb', // gray-200
	tooltipText: '#111827', // gray-900
}

const DARK_CHART_COLORS: ChartColors = {
	axis: '#9ca3af', // gray-400
	grid: '#374151', // gray-700
	tooltipBg: '#1f2937', // gray-800
	tooltipBorder: '#374151', // gray-700
	tooltipText: '#f3f4f6', // gray-100
}

export function useChartColors(): ChartColors {
	return usePrefersDarkScheme() ? DARK_CHART_COLORS : LIGHT_CHART_COLORS
}
