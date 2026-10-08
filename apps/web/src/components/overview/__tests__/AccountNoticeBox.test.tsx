// `getByRole`'s name is a full-string match, so absence probes use a name-free role query
// that cannot go vacuously green after a rename.

import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE,
  ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY,
} from '../../../lib/overview/account-notice-dismissal'
import { AccountNoticeBox } from '../AccountNoticeBox'

const DISMISS_NAME = 'Dismiss privacy notice'

const PILLARS = 'No account needed · Optional sync is EU-hosted · No bank connection.'
const FRAMING = 'Intentional budgeting without bank sync or AI integrations.'

beforeEach(() => {
  localStorage.clear()
  // The component marks <html> on dismiss; a leaked attribute would break later tests.
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

  it('exposes the label as the name and hides the glyph from assistive tech', () => {
    render(<AccountNoticeBox />)

    const button = screen.getByRole('button', { name: DISMISS_NAME })
    expect(button).toHaveAttribute('aria-label', DISMISS_NAME)
    expect(button).toHaveAttribute('type', 'button')

    const glyph = button.querySelector('[aria-hidden="true"]')
    expect(glyph).not.toBeNull()
    expect(glyph?.textContent).toBe('×')
    expect(button).toHaveAccessibleName(DISMISS_NAME)
  })

  /** Rename fence only: jsdom loads no stylesheet. Bare `border` supplies the width a colour class lacks. */
  it('keeps the surface-inset / border / border-gray-300 / text-body / text-muted theming', () => {
    render(<AccountNoticeBox />)

    const box = screen.getByText(PILLARS).closest('[data-account-notice]') as HTMLElement
    expect(box).not.toBeNull()
    expect([...box.classList]).toContain('surface-inset')
    expect([...box.classList]).toContain('border')
    expect([...box.classList]).toContain('border-gray-300')
    expect([...box.classList]).toContain('dark:border-gray-700')
    expect([...screen.getByText(PILLARS).classList]).toContain('text-body')
    expect([...screen.getByText(FRAMING).classList]).toContain('text-muted')
  })

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
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(localStorage.getItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY)).toBe('1')
  })

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

  // Against the server render: a lazy initializer would drop the box from it. Asserts the closing
  // tag because the pillars sentence also opens the meta description.
  it('emits the box in the SERVER render even when already dismissed (AC-3 hydration contract)', () => {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, '1')

    const html = renderToString(<AccountNoticeBox />)

    expect(html).toContain(`>${PILLARS}</p>`)
    expect(html).toContain(`>${FRAMING}</p>`)
    expect(html).toContain('data-account-notice')
  })

  // A dismissal after document load must mark <html>, or a client-side return renders the box
  // until a post-paint effect removes it.
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

  it('ignores an unrelated dismissal key (AC-6, and no key sharing with InstallPrompt)', () => {
    localStorage.setItem('bp-pwa-install-dismissed', Date.now().toString())

    render(<AccountNoticeBox />)

    expect(screen.getByText(PILLARS)).toBeInTheDocument()
  })
})
