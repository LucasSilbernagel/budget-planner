import { useEffect } from 'react'
import { type Theme, useThemeStore } from '../../stores/themeStore'

/**
 * ThemeProvider (story 7-3; dark mode moved to the Free tier in story 25-3).
 * Renders nothing — pure wiring, mounted once at the root layout.
 *
 * **Reflect the persisted theme onto `<html>`.** Tailwind's class-based dark
 * strategy keys every `dark:` variant off a `.dark` class on
 * `document.documentElement`. We keep that class in sync with the theme store
 * for live toggles and rehydration.
 *
 * The sync is wired imperatively (a store subscription), NOT via a
 * `[theme]`-dependency effect, on purpose: at mount the store still holds its
 * deterministic default `'light'` (persisted value not yet rehydrated), so a
 * reactive effect would momentarily apply `'light'` and strip the `.dark`
 * class the no-flash `<head>` script (routes/__root.tsx) already set — a
 * visible flash-to-light on a dark reload (AC-2). We rehydrate first
 * (synchronous for localStorage) and reconcile from the resolved value.
 *
 * Story 25-3 removed the former premium fail-safe-to-light: dark mode is now
 * free for everyone, so a user's chosen theme is always honored — no tier check
 * reverts it.
 */
export function ThemeProvider(): null {
  // Reflect theme → <html class="dark">.
  useEffect(() => {
    const apply = (t: Theme) => {
      document.documentElement.classList.toggle('dark', t === 'dark')
    }

    // Load the persisted preference before the first reflect. StoreHydration
    // also rehydrates this store; calling it here is idempotent and guarantees
    // we never briefly apply the default 'light' over the no-flash script's
    // `.dark` class (AC-2). localStorage-backed rehydration is synchronous.
    // Promise.resolve() normalizes rehydrate()'s `void | Promise<void>` return so
    // .catch is well-typed; swallow like StoreHydration when localStorage is
    // blocked (Safari private mode → SecurityError). getState() then returns the
    // default 'light'.
    Promise.resolve(useThemeStore.persist.rehydrate()).catch(() => {})
    apply(useThemeStore.getState().theme)

    // Live updates when the user toggles the theme.
    return useThemeStore.subscribe((state) => apply(state.theme))
  }, [])

  return null
}
