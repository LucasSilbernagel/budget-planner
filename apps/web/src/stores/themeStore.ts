import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Display theme (story 7-3, FR23).
 *
 * `light` is the product default; `dark` is a premium-gated opt-in surfaced via
 * the footer theme toggle. The active theme is reflected onto a `.dark` class on
 * `<html>` (see `components/theme/ThemeProvider`), which drives Tailwind's
 * class-based dark variants.
 */
export type Theme = 'light' | 'dark'

/**
 * localStorage key for the persisted theme preference.
 *
 * ⚠️ The no-flash `<head>` bootstrap in `routes/__root.tsx` reads this key AND
 * hard-parses the persisted `{ state: { theme } }` shape directly (it runs
 * before any JS module loads, so it cannot import zustand). Keep this key, the
 * `partialize` shape, and that script in sync — a change here that is not
 * mirrored there silently reintroduces the theme flash (AC-4).
 */
export const THEME_STORAGE_KEY = 'budget-planner-theme-prefs-v1'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

// Light is the product default (AC-3: free users always stay light).
const DEFAULT_THEME: Theme = 'light'

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      // Deterministic default. This is the value rendered on the server and on
      // the first client paint, so it MUST NOT be derived from `navigator` / the
      // OS `prefers-color-scheme` — a browser-derived default would cause a
      // hydration mismatch (same discipline as currencyStore.locale). The
      // persisted preference is applied after client rehydration (see
      // lib/store-hydration + components/theme/ThemeProvider) and, crucially,
      // *before first paint* by the no-flash <head> script in routes/__root.tsx.
      theme: DEFAULT_THEME,

      setTheme: (theme) => {
        set({ theme })
      },

      toggleTheme: () => {
        set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' }))
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      // SSR-safe: defer the localStorage read until client-side rehydration (see lib/store-hydration).
      skipHydration: true,
      partialize: (state) => ({ theme: state.theme }),
    }
  )
)

// Selector hooks (mirror currencyStore's export idiom) for stable subscriptions.
export const useTheme = () => useThemeStore((state) => state.theme)

export const useSetTheme = () => useThemeStore((state) => state.setTheme)

export const useToggleTheme = () => useThemeStore((state) => state.toggleTheme)
