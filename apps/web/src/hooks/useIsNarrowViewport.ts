/**
 * useIsNarrowViewport
 *
 * Reports whether the viewport is below Tailwind's `sm` breakpoint (640px),
 * i.e. the phone-width range that Story 6.1 targets (down to 320px).
 *
 * Tailwind utility classes cover layout responsiveness, but some components
 * (notably Recharts) take numeric/enum props that cannot be driven by CSS.
 * This hook lets those components switch behaviour at the same breakpoint.
 *
 * SSR-safe: returns `false` during server render and the first client render
 * (matching the desktop-first SSR markup to avoid hydration mismatches), then
 * updates after mount via `matchMedia`.
 */
import { useEffect, useState } from 'react'

/**
 * Max width (px) considered "narrow" — just below Tailwind's `sm` (640px).
 * Uses `639.98` (not `639`) to match Tailwind's own max-width breakpoint
 * convention, so fractional viewport widths in (639, 640) — reachable via zoom
 * or a non-integer devicePixelRatio — are still treated as mobile, in lockstep
 * with the `sm:` CSS.
 */
export const NARROW_VIEWPORT_MAX_WIDTH = 639.98

export function useIsNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const query = window.matchMedia(`(max-width: ${NARROW_VIEWPORT_MAX_WIDTH}px)`)
    const update = () => setIsNarrow(query.matches)

    update()

    // `MediaQueryList.addEventListener` is unavailable on older mobile browsers
    // (iOS Safari <14, legacy Android) that still expose the deprecated
    // `addListener`/`removeListener` API. Calling the missing method would throw
    // and take down the whole page — on exactly the older phones this hook
    // serves — so feature-detect and fall back.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update)
      return () => query.removeEventListener('change', update)
    }
    query.addListener(update)
    return () => query.removeListener(update)
  }, [])

  return isNarrow
}
