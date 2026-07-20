/**
 * ThemeProvider tests (story 7-3; dark mode moved to the Free tier in story 25-3).
 *
 * ThemeProvider renders nothing; its whole job is a side effect: reflecting the
 * persisted theme onto `<html class="dark">` — on mount (from the rehydrated
 * store) and on every subsequent store change.
 *
 * Story 25-3 removed the former premium fail-safe-to-light, so there is no tier
 * check: a user's chosen theme is always honored. The key regression guard below
 * asserts a free/unauthenticated user's dark choice is NOT reverted.
 */

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, useThemeStore } from '../../../stores/themeStore'
import { ThemeProvider } from '../ThemeProvider'

beforeEach(() => {
  localStorage.clear()
  useThemeStore.setState({ theme: 'light' })
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('ThemeProvider', () => {
  it('reflects theme changes onto <html> live, on store change', () => {
    render(<ThemeProvider />)

    // Starts light: no dark class.
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => {
      useThemeStore.getState().setTheme('dark')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => {
      useThemeStore.getState().setTheme('light')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('applies a persisted dark preference on mount (rehydrated from localStorage)', () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ state: { theme: 'dark' }, version: 0 })
    )

    render(<ThemeProvider />)

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it("honors a free/unauthenticated user's dark choice — no fail-safe reverts it (25-3 AC-2)", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ state: { theme: 'dark' }, version: 0 })
    )
    useThemeStore.setState({ theme: 'dark' })

    render(<ThemeProvider />)

    // No tier check runs anymore: dark stays dark, in the store and in storage.
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    const parsed = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) as string)
    expect(parsed.state.theme).toBe('dark')
  })
})
