/**
 * usePrefersDarkScheme
 *
 * Reports whether the device asks for a dark colour scheme
 * (`prefers-color-scheme: dark`). Story 61.1 (FR93) made the OS preference the
 * app's ONLY theme input: `tailwind.config.js` uses `darkMode: 'media'`, so
 * every `dark:` utility and the `.dark`-free `@media` block in `global.css`
 * follow the device with no JavaScript at all.
 *
 * This hook exists for the one place CSS cannot reach: Recharts renders SVG
 * chrome (axis strokes, grid lines, tooltip fills) as inline presentation
 * attributes chosen in JS, so `lib/chartTheme.ts` needs the preference as a
 * value. Nothing else should need it — if you are reaching for this hook to
 * pick a colour, use a `dark:` utility instead.
 *
 * SSR-safe: returns `false` during server render and the first client render,
 * then updates after mount. Reading the media query during render would make
 * the first client render disagree with the server HTML — the hydration-mismatch
 * class of bug `lib/store-hydration.tsx` documents at length. That deferral is
 * safe for the only consumer: Recharts paints only once it has a measured width,
 * i.e. after mount, so the chart's first painted frame already has the resolved
 * value and there is no visible flash.
 *
 * Subscribes rather than reading once (story 61.1, AC-7): a user who flips their
 * OS theme while the app is open gets the CSS half for free, and must get the
 * chart half too.
 *
 * Shape deliberately mirrors `useIsNarrowViewport` — same SSR guard, same
 * feature-detected listener API. Keep them in step.
 */
import { useEffect, useState } from 'react'

/** The media query the whole app's theme now derives from. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export function usePrefersDarkScheme(): boolean {
  const [prefersDark, setPrefersDark] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const query = window.matchMedia(DARK_SCHEME_QUERY)
    const update = () => setPrefersDark(query.matches)

    update()

    // `MediaQueryList.addEventListener` is unavailable on older mobile browsers
    // (iOS Safari <14, legacy Android) that still expose only the deprecated
    // `addListener`/`removeListener` pair. Calling the missing method would throw
    // and take down the whole page — on exactly the older phones this serves — so
    // feature-detect and fall back. (Same hazard, same fix, as
    // `hooks/useIsNarrowViewport.ts`.)
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update)
      return () => query.removeEventListener('change', update)
    }
    query.addListener(update)
    return () => query.removeListener(update)
  }, [])

  return prefersDark
}
