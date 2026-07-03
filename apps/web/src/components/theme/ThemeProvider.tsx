import { useEffect } from 'react'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { type Theme, useTheme, useThemeStore } from '../../stores/themeStore'

/**
 * ThemeProvider (story 7-3, FR23). Renders nothing — pure wiring, mounted once
 * at the root layout.
 *
 * Two responsibilities:
 *
 * 1. **Reflect the persisted theme onto `<html>`.** Tailwind's class-based dark
 *    strategy keys every `dark:` variant off a `.dark` class on
 *    `document.documentElement`. We keep that class in sync with the theme store
 *    for live toggles and rehydration.
 *
 *    The sync is wired imperatively (a store subscription), NOT via a
 *    `[theme]`-dependency effect, on purpose: at mount the store still holds its
 *    deterministic default `'light'` (persisted value not yet rehydrated), so a
 *    reactive effect would momentarily apply `'light'` and strip the `.dark`
 *    class the no-flash `<head>` script (routes/__root.tsx) already set — a
 *    visible flash-to-light on a paid user's dark reload (AC-4). We rehydrate
 *    first (synchronous for localStorage) and reconcile from the resolved value.
 *
 * 2. **Fail-safe to light for non-premium users (DECISION 3 / AC-3).** Dark mode
 *    is premium-gated, but the no-flash script applies whatever theme is
 *    persisted before the (client-only) tier check resolves. Once
 *    `usePremiumAccess` *authoritatively* resolves to NOT premium (a successful
 *    check returning free / past_due / canceled / unauthenticated — i.e.
 *    `error === null`), we force `theme='light'` and clear the persisted `dark`,
 *    so a lapsed user cannot retain dark from a stale preference. The rare
 *    lapsed-user case sees a brief dark→light correction after hydration — an
 *    accepted, documented tradeoff mirroring 7-2's fail-closed discipline.
 *
 *    We deliberately do NOT clear on a *failed* check (`status.error` set:
 *    network failure, 500, offline PWA). `usePremiumAccess` reports
 *    `hasAccess:false` on any such error, and persisting light there would
 *    silently and permanently destroy a genuinely-paid user's dark preference on
 *    a momentary blip (it would never come back — the no-flash script reads the
 *    overwritten value on every later load). On an unverifiable check we leave
 *    the stored preference untouched; dark mode is cosmetic and the toggle stays
 *    locked, so retaining it until the tier is confirmable is the safe tradeoff.
 */
export function ThemeProvider(): null {
  const { status } = usePremiumAccess()
  const theme = useTheme()

  // Responsibility 1: reflect theme → <html class="dark">.
  useEffect(() => {
    const apply = (t: Theme) => {
      document.documentElement.classList.toggle('dark', t === 'dark')
    }

    // Load the persisted preference before the first reflect. StoreHydration
    // also rehydrates this store; calling it here is idempotent and guarantees
    // we never briefly apply the default 'light' over the no-flash script's
    // `.dark` class (AC-4). localStorage-backed rehydration is synchronous.
    // Promise.resolve() normalizes rehydrate()'s `void | Promise<void>` return so
    // .catch is well-typed; swallow like StoreHydration when localStorage is
    // blocked (Safari private mode → SecurityError). getState() then returns the
    // default 'light'. localStorage-backed rehydration is synchronous.
    Promise.resolve(useThemeStore.persist.rehydrate()).catch(() => {})
    apply(useThemeStore.getState().theme)

    // Live updates: user toggles and the lapsed-user correction below.
    return useThemeStore.subscribe((state) => apply(state.theme))
  }, [])

  // Responsibility 2: fail-safe to light once the tier *authoritatively* resolves
  // to not-premium. `!status.error` gates out failed/transport checks so a
  // transient blip never persists light over a paid user's dark preference (see
  // JSDoc). checkPremiumAccessServer returns error:null for both unauthenticated
  // and authenticated-non-premium users, so free visitors still get corrected.
  useEffect(() => {
    if (status.isLoading) return
    if (!status.hasAccess && !status.error && theme === 'dark') {
      useThemeStore.getState().setTheme('light')
    }
  }, [status.isLoading, status.hasAccess, status.error, theme])

  return null
}
