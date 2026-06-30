/**
 * useIsNarrowViewport — narrow-viewport detection (Story 6.1)
 *
 * Verifies the hook reports the phone-width range (< Tailwind `sm` 640px) so
 * Recharts components can switch to mobile-friendly layouts, and that it is
 * SSR-safe (defaults to `false` when matchMedia is unavailable). Drives the
 * 320px responsive work without a hydration mismatch.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NARROW_VIEWPORT_MAX_WIDTH, useIsNarrowViewport } from '../useIsNarrowViewport'

type Listener = (event: { matches: boolean }) => void

/**
 * Install a controllable matchMedia stub; returns a setter to flip the match.
 * `api: 'legacy'` exposes only the deprecated `addListener`/`removeListener`
 * pair (no `addEventListener`) to emulate iOS Safari <14 / old Android.
 */
function mockMatchMedia(initialMatches: boolean, api: 'modern' | 'legacy' = 'modern') {
  let matches = initialMatches
  const listeners = new Set<Listener>()

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

describe('useIsNarrowViewport', () => {
  it('returns true when the viewport matches the narrow query', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useIsNarrowViewport())
    expect(result.current).toBe(true)
  })

  it('returns false when the viewport is wide', () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useIsNarrowViewport())
    expect(result.current).toBe(false)
  })

  it('reacts to viewport changes', () => {
    const setMatches = mockMatchMedia(false)
    const { result } = renderHook(() => useIsNarrowViewport())
    expect(result.current).toBe(false)

    act(() => setMatches(true))
    expect(result.current).toBe(true)
  })

  it('defaults to false when matchMedia is unavailable (SSR-safe)', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useIsNarrowViewport())
    expect(result.current).toBe(false)
  })

  it('uses the legacy addListener API without throwing (old mobile browsers)', () => {
    // iOS Safari <14 / legacy Android expose matchMedia but no addEventListener.
    const setMatches = mockMatchMedia(false, 'legacy')
    const { result, unmount } = renderHook(() => useIsNarrowViewport())
    expect(result.current).toBe(false)

    act(() => setMatches(true))
    expect(result.current).toBe(true)

    // Cleanup must use removeListener (no throw on unmount).
    expect(() => unmount()).not.toThrow()
  })

  it('sits just below Tailwind sm (640px), matching its max-width convention', () => {
    expect(NARROW_VIEWPORT_MAX_WIDTH).toBe(639.98)
  })
})
