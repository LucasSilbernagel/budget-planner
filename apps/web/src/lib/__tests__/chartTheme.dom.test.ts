import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '../../stores/themeStore'
import { useChartColors } from '../chartTheme'

/**
 * useChartColors (story 11-2, AC-1). Recharts SVG chrome can't use Tailwind
 * `dark:` variants, so the chart colors are chosen in JS from the theme. This is
 * the one piece of real logic the dark-mode-coverage work added.
 */
afterEach(() => {
  useThemeStore.setState({ theme: 'light' })
})

describe('useChartColors', () => {
  it('returns the light palette when the theme is light', () => {
    useThemeStore.setState({ theme: 'light' })
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#6b7280') // gray-500
    expect(result.current.grid).toBe('#e5e7eb') // gray-200
    expect(result.current.tooltipBg).toBe('#ffffff')
    expect(result.current.tooltipText).toBe('#111827') // gray-900
  })

  it('returns the dark palette when the theme is dark', () => {
    useThemeStore.setState({ theme: 'dark' })
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#9ca3af') // gray-400
    expect(result.current.grid).toBe('#374151') // gray-700
    expect(result.current.tooltipBg).toBe('#1f2937') // gray-800
    expect(result.current.tooltipText).toBe('#f3f4f6') // gray-100
  })

  it('uses an AA-legible axis color on dark, not the sub-AA gray-500 7-3 flagged', () => {
    useThemeStore.setState({ theme: 'dark' })
    const { result } = renderHook(() => useChartColors())
    // gray-500 (#6b7280) fails AA on a gray-800 card; the dark axis must be lighter.
    expect(result.current.axis).not.toBe('#6b7280')
  })
})
