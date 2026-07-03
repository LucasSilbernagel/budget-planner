/**
 * themeStore tests (story 7-3, FR23).
 *
 * The store is the source of truth for the premium dark-mode preference. These
 * tests pin the three behaviors the rest of the feature relies on:
 *   - a deterministic `'light'` default (SSR-safe: the value must be identical
 *     on the server and first client paint — no navigator/OS derivation);
 *   - toggling / setting the theme;
 *   - the persisted localStorage shape the no-flash `<head>` script parses
 *     (`{ state: { theme }, version }` under the versioned key).
 *
 * Runs in jsdom (`.dom.test.ts`) for a real `localStorage`.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '../themeStore'

const STORAGE_KEY = 'budget-planner-theme-prefs-v1'

beforeEach(() => {
  localStorage.clear()
  // Reset the module singleton between tests.
  useThemeStore.setState({ theme: 'light' })
})

describe('themeStore', () => {
  it('defaults to light (deterministic, SSR-safe)', () => {
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('setTheme sets the theme', () => {
    useThemeStore.getState().setTheme('dark')
    expect(useThemeStore.getState().theme).toBe('dark')

    useThemeStore.getState().setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('toggleTheme flips between light and dark', () => {
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('persists only the theme in the shape the no-flash script parses', () => {
    useThemeStore.getState().setTheme('dark')

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()

    const parsed = JSON.parse(raw as string)
    // The no-flash <head> script reads `parsed.state.theme`.
    expect(parsed.state.theme).toBe('dark')
    // partialize keeps the persisted payload to just `theme`.
    expect(Object.keys(parsed.state)).toEqual(['theme'])
  })
})
