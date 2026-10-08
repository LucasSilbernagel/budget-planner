import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NARROW_VIEWPORT_MAX_WIDTH, useIsNarrowViewport } from '../useIsNarrowViewport'

type Listener = (event: { matches: boolean }) => void

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
	// Spreading a getter would snapshot it, so define `matches` as a live getter.
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

		expect(() => unmount()).not.toThrow()
	})

	it('sits just below Tailwind sm (640px), matching its max-width convention', () => {
		expect(NARROW_VIEWPORT_MAX_WIDTH).toBe(639.98)
	})
})
