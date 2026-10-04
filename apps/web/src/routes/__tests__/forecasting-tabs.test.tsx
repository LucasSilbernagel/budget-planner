/**
 * The `/forecasting` tab strip fits a 320 px screen (story 91.3, FR147).
 *
 * At 320 px the three tabs were 388 px wide in a 288 px content box, so the page
 * scrolled sideways by 80 px (MEASURED under DejaVu, `91-3-evidence/`). Below the
 * `sm` breakpoint the icons are hidden and the padding halves, and the buttons
 * share the strip's width so a label that runs short wraps between its words.
 *
 * jsdom has no layout and no Tailwind, so these pin the class TOKENS, never a
 * computed style. Whether the strip actually fits is guarded by the CI screenshot
 * `forecasting-320-light` (`e2e/nav.screenshot.paid.spec.ts`). Every phone token is
 * `max-sm:`, so ≥ 640 px renders as before (`forecasting-1280-light` unchanged).
 *
 * The buttons are found by role and name, which also pins that the names did not
 * change: the icons are `aria-hidden`, so hiding them cannot rename a tab.
 */

import { renderWithRouter, screen } from '@/test/utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import { Route } from '../forecasting'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

// Isolation only, as in `forecasting-intro.test.tsx`: keeps the mount effect off the network.
vi.mock('../../lib/forecasting/forecast-api', () => ({
  fetchProfiles: vi.fn(async () => ({ success: true, data: [] })),
  fetchForecasts: vi.fn(async () => ({ success: true, data: [] })),
  saveForecast: vi.fn(async () => ({ success: true, data: null })),
  deleteForecast: vi.fn(async () => ({ success: true })),
}))

const ForecastingPage = Route.options.component as () => React.ReactElement

const TAB_NAMES = ['Scenario Builder', 'Projections', 'My Forecasts'] as const

beforeEach(() => {
  const status: PremiumAccessStatus = {
    hasAccess: true,
    subscriptionStatus: 'active',
    isLoading: false,
    error: null,
    isAuthenticated: true,
  }
  usePremiumAccess.mockReturnValue({ status })
})

async function renderTabs(): Promise<HTMLElement[]> {
  renderWithRouter(<ForecastingPage />)
  await screen.findByTestId('forecasting-intro')
  return TAB_NAMES.map((name) => screen.getByRole('button', { name }))
}

function tokens(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('forecasting tab strip below 640 px (story 91.3)', () => {
  it('keeps three tabs, in order, with their names, in one strip', async () => {
    const buttons = await renderTabs()
    const strip = buttons[0]?.parentElement as HTMLElement

    expect(buttons).toHaveLength(3)
    // Direct children of ONE strip: `forecasting-intro.test.tsx` finds the strip as
    // a button's nearest ancestor div, so a wrapper per button would retarget it.
    expect(Array.from(strip.children)).toEqual(buttons)
    for (const button of buttons) expect(button).toHaveAttribute('type', 'button')
  })

  it('shares the strip width and halves the padding on a phone, and keeps the desktop padding', async () => {
    for (const button of await renderTabs()) {
      expect(tokens(button)).toEqual(
        expect.arrayContaining(['max-sm:flex-1', 'max-sm:min-w-0', 'max-sm:px-1.5', 'px-4'])
      )
      // Story 93.1 (D3 option B): px-1.5, not px-2. At px-2 "Projections" (76.5 px
      // under DejaVu) did not fit its 74.7 px content box, so the label wrap below
      // would split it at 100 % text size (MEASURED, `93-1-evidence/`).
      expect(tokens(button)).not.toContain('max-sm:px-2')
    }
  })

  it('lets a label that is wider than its button break inside a word, on a phone only (93.1)', async () => {
    // MEASURED (story 93.1, DejaVu, 320 px): at 125 % text size "Projections" overflowed
    // its button by 4.5 px each side, at 150 % it crossed both neighbours by 10.1 px.
    // Breaking the word ends the overlap; `max-sm:` keeps >= 640 px as it was.
    for (const button of await renderTabs()) {
      const label = Array.from(button.querySelectorAll('span')).find((s) => s.children.length === 0)
      expect(tokens(label as Element)).toContain('max-sm:[overflow-wrap:anywhere]')
      expect(tokens(label as Element)).not.toContain('[overflow-wrap:anywhere]')
    }
  })

  it('hides each icon on a phone and drops the gap the icon needed', async () => {
    for (const button of await renderTabs()) {
      const icon = button.querySelector('svg')
      expect(icon, 'every tab still renders its icon').not.toBeNull()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      expect(tokens(icon as Element)).toContain('max-sm:hidden')

      const label = Array.from(button.querySelectorAll('span')).find((s) => s.children.length === 0)
      expect(label?.textContent).toBe(button.textContent)
      expect(tokens(label as Element)).toEqual(expect.arrayContaining(['ml-2', 'max-sm:ml-0']))
    }
  })

  it('centres a label that wraps onto two lines', async () => {
    for (const button of await renderTabs()) {
      const content = button.firstElementChild as Element
      expect(tokens(content)).toEqual(
        expect.arrayContaining([
          'flex',
          'items-center',
          'max-sm:justify-center',
          'max-sm:text-center',
        ])
      )
    }
  })
})
