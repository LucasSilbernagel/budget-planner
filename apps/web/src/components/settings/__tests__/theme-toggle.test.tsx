/**
 * ThemeToggle tests (story 7-3; dark mode moved to the Free tier in story 25-3).
 *
 * Dark mode is now a free feature for every user, so the toggle has no tier
 * gating: it renders a live `role="switch"` for everyone, flipping the persisted
 * theme store. These tests assert the working switch + persistence — there is no
 * loading skeleton, no locked affordance, no Premium badge, and no upgrade prompt.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, useThemeStore } from '../../../stores/themeStore'
import { ThemeToggle } from '../theme-toggle'

beforeEach(() => {
  useThemeStore.setState({ theme: 'light' })
  try {
    localStorage.removeItem(THEME_STORAGE_KEY)
  } catch {
    // localStorage may be unavailable in some environments; ignore.
  }
})

describe('ThemeToggle', () => {
  it('renders a live switch for every user (no gating, badge, or skeleton)', () => {
    render(<ThemeToggle />)

    expect(screen.getByRole('switch')).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    // No premium chrome survives the ungating.
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-gate-skeleton')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-gate-locked')).not.toBeInTheDocument()
    expect(screen.queryByTestId('premium-prompt')).not.toBeInTheDocument()
  })

  it('toggles the theme store on click and back', () => {
    render(<ThemeToggle />)
    const toggle = screen.getByRole('switch')

    fireEvent.click(toggle)
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    expect(useThemeStore.getState().theme).toBe('light')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('persists a chosen dark theme to localStorage (survives reload; no fail-safe reverts it)', () => {
    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('switch'))
    expect(useThemeStore.getState().theme).toBe('dark')

    // The persist middleware writes the partialized `{ state: { theme } }` shape
    // that the no-flash <head> bootstrap reads on the next load.
    const persisted = localStorage.getItem(THEME_STORAGE_KEY)
    expect(persisted).toBeTruthy()
    expect(JSON.parse(persisted ?? '{}').state.theme).toBe('dark')
  })

  it('keeps focus-visible affordance (focus:ring-2, WCAG 2.4.7)', () => {
    render(<ThemeToggle />)
    // The ring width class must be present — ring color alone + outline-none is an
    // invisible focus state (recurring Epic 15 a11y regression).
    expect(screen.getByRole('switch').className).toContain('focus:ring-2')
  })
})
