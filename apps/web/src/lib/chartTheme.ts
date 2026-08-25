import { useTheme } from '../stores/themeStore'

/**
 * Recharts chrome colors (axes, grid, tooltip) for the current theme (story
 * 11-2, AC-1). Recharts renders SVG with hardcoded default strokes/fills that
 * are only legible on a light canvas, so charts on the dark `.surface` cards
 * need explicit colors. Centralized here so every chart (the Overview bars and
 * pies, SavingsChart, RetirementTimeline, CategoryBreakdown, and the Premium
 * forecasting projection) darkens identically instead of each re-deriving the
 * palette.
 *
 * Values mirror the token palette in `global.css`: gray-500/200 on light,
 * gray-400/700 on dark (gray-400 axis text clears WCAG-AA on both canvases).
 */
export interface ChartColors {
  /** Axis tick + label text and axis lines. */
  axis: string
  /** Cartesian grid lines. */
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

/**
 * Reads the persisted theme. The store uses `skipHydration`, so on the server
 * and first client paint this returns the default ('light'); Recharts only
 * paints after mount (it needs a measured width), by which point the store has
 * rehydrated — so the chart matches the rest of the page with no visible flash.
 */
export function useChartColors(): ChartColors {
  return useTheme() === 'dark' ? DARK_CHART_COLORS : LIGHT_CHART_COLORS
}
