import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChartColors } from '../chartTheme'

/**
 * useChartColors (story 11-2, AC-1; re-sourced in story 61.1, FR93).
 *
 * Recharts SVG chrome can't use Tailwind `dark:` variants, so the chart colors
 * are chosen in JS. Story 61.1 removed the theme STORE and made the device's
 * `prefers-color-scheme` the app's only theme input, so these tests drive
 * `matchMedia` rather than `useThemeStore.setState`.
 *
 * ⚠️ jsdom does not implement `matchMedia` AT ALL — without the stub below,
 * `usePrefersDarkScheme` takes its SSR guard branch and every case would read
 * the light palette, including the dark ones. The stub is what makes the dark
 * arms meaningful; `mockMatchMedia` is the house helper, copied from
 * `hooks/__tests__/useIsNarrowViewport.test.tsx`.
 */

type Listener = (event: { matches: boolean }) => void

/**
 * Install a controllable `matchMedia` stub; returns a setter that flips the
 * match AND notifies subscribers, so a live OS theme change can be simulated
 * (story 61.1, AC-7).
 */
function mockMatchMedia(initialMatches: boolean, api: 'modern' | 'legacy' = 'modern') {
  let matches = initialMatches
  const listeners = new Set<Listener>()

  // `api: 'legacy'` exposes ONLY the deprecated `addListener`/`removeListener`
  // pair, emulating iOS Safari <14 / old Android — the browsers the hook's
  // fallback exists for. Without this arm that branch never executes in any
  // test, and a typo in it would ship and throw on exactly those phones.
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
  // Define `matches` as a live getter on the final object — spreading a getter
  // would snapshot its value, so the listener-driven updates below wouldn't show.
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
    // The CSS half of AC-7 is free (media queries are live); the chart half is
    // not — it is only live if the hook SUBSCRIBES rather than reading once.
    // This case is the whole reason the hook has a listener, so it must fail if
    // the subscription is removed.
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
    // ⚠️ Without this, every case in this file passes even if the hook asks for
    // `(prefers-color-scheme: light)` or `(max-width: 640px)` — the stub returns
    // the same MediaQueryList for ANY argument, so the light/dark/live cases
    // would all still read the stub's `matches`. The hook's shape was copied from
    // `useIsNarrowViewport`, which queries a WIDTH, so that copy-paste is the
    // realistic mutation and nothing else here would catch it.
    //
    // ⚠️⚠️ THE QUERY IS SPELLED OUT AS A LITERAL, DELIBERATELY. Importing
    // `DARK_SCHEME_QUERY` from the hook and asserting against it compares the
    // constant with itself: a tautology that stays green when the query is
    // changed to anything at all. That exact version was written here first and
    // mutation-proven vacuous (M5) before this replaced it.
    mockMatchMedia(true)
    renderHook(() => useChartColors())
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })

  it('subscribes through the LEGACY addListener API when addEventListener is absent', () => {
    // iOS Safari <14 / legacy Android expose only `addListener`. Calling the
    // missing `addEventListener` would throw and take down the page — on exactly
    // the older phones this branch serves — so the fallback must be exercised,
    // not merely written. Mirrors `useIsNarrowViewport.test.tsx`.
    const setMatches = mockMatchMedia(false, 'legacy')
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#6b7280')

    act(() => {
      setMatches(true)
    })

    expect(result.current.axis).toBe('#9ca3af')
  })

  it('falls back to the light palette when matchMedia is unavailable (SSR-safe)', () => {
    // Server render and the first client render: reading the query during render
    // would be a hydration mismatch, so the hook must resolve light and update
    // after mount. Recharts paints only after it has a measured width, so this
    // deferral is never visible.
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useChartColors())
    expect(result.current.axis).toBe('#6b7280')
  })
})
