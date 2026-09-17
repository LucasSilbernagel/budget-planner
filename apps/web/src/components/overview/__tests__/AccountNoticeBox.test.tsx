/**
 * The dismissable Overview "No account needed" box (story 55.1, FR82).
 *
 * ⚠️ WHAT THIS FILE CAN AND CANNOT PROVE. jsdom has no layout and no cascade
 * beyond inline styles, so the PRE-PAINT half of this feature — the <head>
 * bootstrap plus the `[data-dismiss-account-notice='1']` rule in `global.css` —
 * is NOT testable here. Those are covered by
 * `lib/overview/__tests__/no-flash-account-notice-script.dom.test.ts` (the
 * bootstrap's behaviour) and `e2e/overview-account-notice.spec.ts` (the first
 * frame in a real browser, with the CSS rule live). What this file owns is the
 * React half: the affordance, the write, the effect-gated render, and the
 * fail-open behaviour.
 *
 * ⚠️ THE BUTTON'S ACCESSIBLE NAME IS "Dismiss", EXACTLY. `getByRole`'s `name`
 * option is a FULL-STRING match, so if the label is ever changed, every probe
 * written against the old name stops matching and reports GREEN rather than
 * red — the failure shape recorded in project memory as
 * `icon-only-button-naming`. `DISMISS_NAME` below is the single source of truth
 * for these tests, and the "absence" probes deliberately use a name-free role
 * query so they cannot go vacuously green the same way.
 */

import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE,
  ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY,
} from '../../../lib/overview/account-notice-dismissal'
import { AccountNoticeBox } from '../AccountNoticeBox'

/** Exact accessible name of the close affordance (AC-1). */
const DISMISS_NAME = 'Dismiss privacy notice'

const PILLARS = 'No account needed · Optional sync is EU-hosted · No bank connection.'
const FRAMING = 'Intentional budgeting without bank sync or AI integrations.'

beforeEach(() => {
  localStorage.clear()
  // The component now marks <html> on dismiss, and a leaked attribute would
  // make a later test's "not marked" assertion fail for an unrelated reason.
  document.documentElement.removeAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)
})

describe('AccountNoticeBox — not yet dismissed', () => {
  it('renders both copy lines and a named close button (AC-1)', () => {
    render(<AccountNoticeBox />)

    expect(screen.getByText(PILLARS)).toBeInTheDocument()
    expect(screen.getByText(FRAMING)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: DISMISS_NAME })).toBeInTheDocument()
  })

  /**
   * AC-1: "not merely a decorative icon". The × glyph must be hidden from the
   * accessibility tree so the button's name comes from the label alone — a
   * screen reader must never announce "times" or "multiplication sign".
   */
  it('exposes the label as the name and hides the glyph from assistive tech', () => {
    render(<AccountNoticeBox />)

    const button = screen.getByRole('button', { name: DISMISS_NAME })
    expect(button).toHaveAttribute('aria-label', DISMISS_NAME)
    expect(button).toHaveAttribute('type', 'button')

    const glyph = button.querySelector('[aria-hidden="true"]')
    expect(glyph).not.toBeNull()
    expect(glyph?.textContent).toBe('×')
    // The accessible name must not be assembled from the glyph.
    expect(button).toHaveAccessibleName(DISMISS_NAME)
  })

  /**
   * AC-5: the box's theming is untouched. These three tokens are what keeps it
   * legible in dark mode; the story's only visual addition is the close button.
   */
  it('keeps the surface-inset / text-body / text-muted theming (AC-5)', () => {
    render(<AccountNoticeBox />)

    const box = screen.getByText(PILLARS).closest('[data-account-notice]') as HTMLElement
    expect(box).not.toBeNull()
    // Class TOKEN membership, not substring — `surface-inset-foo` must not pass.
    expect([...box.classList]).toContain('surface-inset')
    expect([...screen.getByText(PILLARS).classList]).toContain('text-body')
    expect([...screen.getByText(FRAMING).classList]).toContain('text-muted')
  })

  /**
   * ⚠️ WCAG 2.2 SC 2.5.8. jsdom cannot measure a box, so this asserts the
   * size FLOOR is declared; `e2e/overview-account-notice.spec.ts` measures the
   * real rendered rect. Story 51.2's review found a desktop target-size defect
   * that every unit gate passed, which is why both layers exist.
   */
  it('declares a >=24px pointer target on the close button (SC 2.5.8)', () => {
    render(<AccountNoticeBox />)
    const tokens = [...screen.getByRole('button', { name: DISMISS_NAME }).classList]
    expect(tokens).toContain('min-h-7')
    expect(tokens).toContain('min-w-7')
  })
})

describe('AccountNoticeBox — dismissing', () => {
  it('removes the box and records the dismissal permanently (AC-1, AC-2)', () => {
    render(<AccountNoticeBox />)

    act(() => {
      screen.getByRole('button', { name: DISMISS_NAME }).click()
    })

    expect(screen.queryByText(PILLARS)).toBeNull()
    expect(screen.queryByText(FRAMING)).toBeNull()
    // Name-free role probe: cannot pass vacuously if the label ever changes.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(localStorage.getItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY)).toBe('1')
  })

  /**
   * AC-3, the write half of fail-open. A blocked store must not break the
   * click: the box still goes away for this visit, it just will not stay away.
   */
  it('still hides the box when the store refuses the write (AC-3)', () => {
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    render(<AccountNoticeBox />)
    expect(() => {
      act(() => {
        screen.getByRole('button', { name: DISMISS_NAME }).click()
      })
    }).not.toThrow()

    expect(screen.queryByText(PILLARS)).toBeNull()
  })
})

describe('AccountNoticeBox — returning user', () => {
  it('renders nothing once the flag is set (AC-4, post-hydration half)', () => {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, '1')

    render(<AccountNoticeBox />)

    expect(screen.queryByText(PILLARS)).toBeNull()
    expect(screen.queryByText(FRAMING)).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  /**
   * ⚠️ AC-3's HYDRATION CONTRACT — asserted against the SERVER render, which is
   * the only place the property actually lives. The server has no localStorage,
   * so it must emit the box unconditionally; the first CLIENT render must agree
   * with that HTML, and only the effect afterwards may remove it.
   *
   * The failure this catches: a lazy `useState(wasAccountNoticeDismissed())`
   * initializer reads storage DURING render. Under `renderToString` in jsdom —
   * where `localStorage` exists and the flag below is set — that returns null,
   * the server HTML loses the box, and the real browser gets a hydration
   * mismatch. Every other test in this file stays green through that bug.
   *
   * ⚠️ This also mirrors, at unit level, the SSR "SEO fence" in
   * `e2e/loading-state.spec.ts`: the assertion is on the CLOSING TAG, not a
   * bare phrase, because the pillars sentence also opens the page's
   * `<meta name="description">` — a bare `toContain` would match the head while
   * the body copy was gone. Do not relax it to a plain phrase.
   */
  it('emits the box in the SERVER render even when already dismissed (AC-3 hydration contract)', () => {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, '1')

    const html = renderToString(<AccountNoticeBox />)

    expect(html).toContain(`>${PILLARS}</p>`)
    expect(html).toContain(`>${FRAMING}</p>`)
    expect(html).toContain('data-account-notice')
  })

  /**
   * ⚠️ THE IN-SESSION FLASH GUARD (code review HIGH). The `<head>` bootstrap
   * runs once per DOCUMENT load, so a dismissal that happens afterwards must
   * mark `<html>` itself — otherwise a client-side navigation away from `/` and
   * back remounts this component, which renders the box and only removes it in
   * a post-paint effect. Reproduced in a real browser: the node re-attached
   * with `display: "block"` while `<html>` carried no attribute.
   *
   * This is the unit-level half; `e2e/overview-account-notice.spec.ts` drives
   * the real SPA navigation.
   */
  it('marks <html> on dismiss so a later remount cannot paint the box (AC-4)', () => {
    render(<AccountNoticeBox />)
    expect(document.documentElement.hasAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)).toBe(false)

    act(() => {
      screen.getByRole('button', { name: DISMISS_NAME }).click()
    })

    expect(document.documentElement.getAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)).toBe('1')
  })

  it('shows the box when the store throws on read — fails open (AC-3)', () => {
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: access denied')
    })

    render(<AccountNoticeBox />)

    expect(screen.getByText(PILLARS)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: DISMISS_NAME })).toBeInTheDocument()
  })

  /**
   * AC-6: per-browser only. A dismissal recorded under a DIFFERENT key — which
   * is what another device/browser amounts to from this component's point of
   * view, and also what `InstallPrompt`'s key is — must not hide this box.
   */
  it('ignores an unrelated dismissal key (AC-6, and no key sharing with InstallPrompt)', () => {
    localStorage.setItem('bp-pwa-install-dismissed', Date.now().toString())

    render(<AccountNoticeBox />)

    expect(screen.getByText(PILLARS)).toBeInTheDocument()
  })
})
