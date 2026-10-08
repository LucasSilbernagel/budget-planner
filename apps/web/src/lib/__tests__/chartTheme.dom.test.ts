import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChartColors } from '../chartTheme'

/** jsdom has no `matchMedia`; without the stub every case would read the light palette. */

type Listener = (event: { matches: boolean }) => void

function mockMatchMedia(initialMatches: boolean, api: 'modern' | 'legacy' = 'modern') {
  let matches = initialMatches
  const listeners = new Set<Listener>()

  // `api: 'legacy'` exposes only `addListener`/`removeListener`, as on iOS Safari < 14.
  const listenerApi =
    api === 'modern'
      ? {
          addEventListener: (_: string, cb: Listener) => listeners.add(cb),
          removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
        }
      : {
          addListener: (cb: Listener) => listeners.add(cb),
          removeListener: (cb: Listener) => listeners.delete(cb),
        }
  // A live getter: spreading would snapshot `matches`.
  const mql = Object.defineProperty(listenerApi, 'matches', {
    get: () => matches,
    enumerable: true,
  })

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql)
  )

  return (next: boolean) => {
    matches = next
    for (const cb of listeners) {
      cb({ matches })
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useChartColors', () => {
  it('returns the light palette when the device prefers light', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#6b7280') // gray-500
    expect(result.current.grid).toBe('#e5e7eb') // gray-200
    expect(result.current.tooltipBg).toBe('#ffffff')
    expect(result.current.tooltipText).toBe('#111827') // gray-900
  })

  it('returns the dark palette when the device prefers dark', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#9ca3af') // gray-400
    expect(result.current.grid).toBe('#374151') // gray-700
    expect(result.current.tooltipBg).toBe('#1f2937') // gray-800
    expect(result.current.tooltipText).toBe('#f3f4f6') // gray-100
  })

  it('uses an AA-legible axis color on dark, not the sub-AA gray-500 7-3 flagged', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useChartColors())
    // gray-500 (#6b7280) fails AA on a gray-800 card; the dark axis must be lighter.
    expect(result.current.axis).not.toBe('#6b7280')
  })

  it('follows a LIVE change of the device preference without a remount (61.1, AC-7)', () => {
    const setMatches = mockMatchMedia(false)
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#6b7280')

    act(() => {
      setMatches(true)
    })

    expect(result.current.axis).toBe('#9ca3af')
    expect(result.current.grid).toBe('#374151')
  })

  it('subscribes to the DARK colour-scheme query specifically', () => {
    // Spelled as a literal: importing the query constant would compare it with itself.
    // The stub answers any query, so this is the only check on the query string.
    mockMatchMedia(true)
    renderHook(() => useChartColors())
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })

  it('subscribes through the LEGACY addListener API when addEventListener is absent', () => {
    const setMatches = mockMatchMedia(false, 'legacy')
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#6b7280')

    act(() => {
      setMatches(true)
    })

    expect(result.current.axis).toBe('#9ca3af')
  })

  it('falls back to the light palette when matchMedia is unavailable (SSR-safe)', () => {
    // Reading the query during render would mismatch hydration, so the hook starts light.
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#6b7280')
  })
})
