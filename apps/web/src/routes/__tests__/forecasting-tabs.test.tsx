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
 * Since story 120.2 (FR188) they are still `<button>` elements but carry
 * `role="tab"`, so the locators ask for `tab`; the class-token pins are unchanged.
 */

import { renderWithRouter, screen } from '@/test/utils'
import userEvent from '@testing-library/user-event'
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
  return TAB_NAMES.map((name) => screen.getByRole('tab', { name }))
}

function tokens(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

describe('forecasting tab strip below 640 px (story 91.3)', () => {
  it('gives an inactive tab AA-contrast text in both themes (story 115.2)', async () => {
    // gray-500 on the strip's gray-100 was 4.39:1 and gray-400 on dark gray-700
    // 4.06:1, below AA's 4.5:1; gray-600 / gray-300 are 6.87 / 7.00. Tokens,
    // not paint (jsdom has no Tailwind): the Lighthouse re-run is the proof.
    const inactive = (await renderTabs()).filter((button) => !tokens(button).includes('shadow-sm'))
    expect(inactive).toHaveLength(2)
    for (const button of inactive) {
      expect(tokens(button)).toEqual(
        expect.arrayContaining(['text-gray-600', 'dark:text-gray-300'])
      )
      expect(tokens(button)).not.toContain('text-gray-500')
      expect(tokens(button)).not.toContain('dark:text-gray-400')
    }
  })

  it('keeps three tabs, in order, with their names, in one strip', async () => {
    const buttons = await renderTabs()
    const strip = buttons[0]?.parentElement as HTMLElement

    expect(buttons).toHaveLength(3)
    // Direct children of ONE strip: `forecasting-intro.test.tsx` finds the strip as
    // a button's nearest ancestor div, so a wrapper per button would retarget it.
    expect(Array.from(strip.children)).toEqual(buttons)
    for (const button of buttons) expect(button).toHaveAttribute('type', 'button')
  })

  it('shares the strip width and narrows the padding on a phone, and keeps the desktop padding', async () => {
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

/**
 * The views are APG tabs (story 120.2, FR188): a labelled tablist, one selected tab,
 * each tab controlling a panel that EXISTS (Projections and My Forecasts content is
 * still mounted only while active, but its panel wrapper is always rendered), a
 * roving tabIndex, and automatic activation on ←/→ (wrapping) and Home/End.
 */
describe('tab semantics (story 120.2)', () => {
  function selected(): string[] {
    return screen
      .getAllByRole('tab')
      .filter((tab) => tab.getAttribute('aria-selected') === 'true')
      .map((tab) => tab.textContent ?? '')
  }

  it('exposes a labelled tablist with exactly one selected tab and a roving tabIndex', async () => {
    const tabs = await renderTabs()
    expect(screen.getByRole('tablist', { name: 'Forecasting views' })).toBe(tabs[0]?.parentElement)
    expect(selected()).toEqual(['Scenario Builder'])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
  })

  it('points every tab, selected or not, at an existing tabpanel labelled by that tab', async () => {
    for (const tab of await renderTabs()) {
      const panelId = tab.getAttribute('aria-controls')
      expect(panelId, `${tab.textContent} has aria-controls`).toBeTruthy()
      const panel = document.getElementById(panelId as string)
      expect(panel, `${tab.textContent}'s panel exists`).not.toBeNull()
      expect(panel).toHaveAttribute('role', 'tabpanel')
      expect(tab.id).toBeTruthy()
      expect(panel).toHaveAttribute('aria-labelledby', tab.id)
    }
  })

  it('moves focus and selection with the arrow keys, wrapping, and with Home/End', async () => {
    const user = userEvent.setup()
    const [builder, projections, saved] = await renderTabs()

    builder?.focus()
    await user.keyboard('{ArrowRight}')
    expect(projections).toHaveFocus()
    expect(selected()).toEqual(['Projections'])
    expect(projections?.tabIndex).toBe(0)
    expect(builder?.tabIndex).toBe(-1)
    // Automatic activation: the panel content switched too.
    expect(screen.getByRole('heading', { name: 'Forecast Projections' })).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(saved).toHaveFocus()
    expect(selected()).toEqual(['My Forecasts'])

    // Wraps forward from the last tab ...
    await user.keyboard('{ArrowRight}')
    expect(builder).toHaveFocus()
    expect(selected()).toEqual(['Scenario Builder'])

    // ... and backward from the first.
    await user.keyboard('{ArrowLeft}')
    expect(saved).toHaveFocus()
    expect(selected()).toEqual(['My Forecasts'])

    await user.keyboard('{Home}')
    expect(builder).toHaveFocus()
    expect(selected()).toEqual(['Scenario Builder'])

    await user.keyboard('{End}')
    expect(saved).toHaveFocus()
    expect(selected()).toEqual(['My Forecasts'])
  })

  it('leaves Alt / Ctrl / Meta + arrow and Home/End to the browser (code review)', async () => {
    const user = userEvent.setup()
    const [builder] = await renderTabs()
    builder?.focus()
    for (const combo of [
      '{Alt>}{ArrowRight}{/Alt}',
      '{Alt>}{ArrowLeft}{/Alt}',
      '{Control>}{End}{/Control}',
      '{Meta>}{ArrowRight}{/Meta}',
    ]) {
      let prevented: boolean | undefined
      const spy = (event: KeyboardEvent) => {
        prevented = event.defaultPrevented
      }
      document.addEventListener('keydown', spy)
      await user.keyboard(combo)
      document.removeEventListener('keydown', spy)
      expect(prevented, `${combo} is not swallowed`).toBe(false)
      expect(selected(), `${combo} does not switch tabs`).toEqual(['Scenario Builder'])
      expect(builder).toHaveFocus()
    }
  })

  it('keeps an unsaved builder edit across a keyboard round trip (the builder stays mounted)', async () => {
    const user = userEvent.setup()
    const [builder] = await renderTabs()
    const field = screen.getByLabelText('Projection Period (years)')
    await user.clear(field)
    await user.type(field, '7')
    expect(field).toHaveValue(7)

    builder?.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}{ArrowLeft}')
    expect(selected()).toEqual(['Scenario Builder'])
    expect(screen.getByLabelText('Projection Period (years)')).toBe(field)
    expect(field).toHaveValue(7)
  })

  it('still switches on click', async () => {
    const user = userEvent.setup()
    const [, projections] = await renderTabs()
    await user.click(projections as HTMLElement)
    expect(selected()).toEqual(['Projections'])
    expect(projections?.tabIndex).toBe(0)
  })
})
