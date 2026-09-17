/**
 * Dismissal persistence for the Overview "No account needed" notice
 * (story 55.1, AC-2 / AC-3).
 *
 * Two properties are load-bearing and each has a concrete failure mode:
 *
 *   1. **The predicate is `=== '1'`, not truthiness.** `wasAccountNoticeDismissed`
 *      and the pre-paint bootstrap in `no-flash-account-notice-script` parse the
 *      same key, and a value one accepts while the other rejects hides the box
 *      on the first frame and restores it after hydration. The junk-value cases
 *      below pin the contract on this side; the bootstrap's own suite pins the
 *      identical set on the other.
 *
 *   2. **Every storage failure fails OPEN** (box shows). Safari private mode
 *      throws `SecurityError` on access; a throw escaping this module would take
 *      the whole Overview down, and a `true` on failure would suppress the box
 *      forever with no way back.
 *
 * ⚠️ NO EXPIRY, DELIBERATELY. `InstallPrompt` re-surfaces after 30 days; this
 * does not (AC-2). There is no "stale timestamp" case to test here because
 * there is no timestamp — that is the point of the fixed `'1'` sentinel.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE,
  ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY,
  DISMISSED_VALUE,
  markAccountNoticeDismissedOnDocument,
  rememberAccountNoticeDismissal,
  wasAccountNoticeDismissed,
} from '../account-notice-dismissal'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY', () => {
  it('is the dedicated overview key and NOT the PWA install key (AC-2)', () => {
    expect(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY).toBe('bp-overview-account-notice-dismissed')
    // The whole point of a distinct key: dismissing this box must not silence
    // the install prompt, nor vice versa.
    expect(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY).not.toBe('bp-pwa-install-dismissed')
  })

  /**
   * ⚠️ THIS IS A SCRIPT-INJECTION GUARD, NOT A NAMING PREFERENCE (code review).
   * The key and the attribute are interpolated into the raw inline bootstrap
   * string in `../no-flash-account-notice-script`. A value containing `'` or
   * `</script>` would break that script syntactically — or terminate the script
   * element — and the CSP drift guard would NOT notice, because the hash is
   * derived from the same broken string (both sides drift together). Constrain
   * the inputs instead.
   */
  it('and the attribute are safe to interpolate into an inline <script> body', () => {
    expect(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY).toMatch(/^[a-z0-9-]+$/)
    expect(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE).toMatch(/^[a-z0-9-]+$/)
    expect(DISMISSED_VALUE).toMatch(/^[A-Za-z0-9]+$/)
  })
})

describe('markAccountNoticeDismissedOnDocument', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)
  })

  /**
   * The in-session half of AC-4. The `<head>` bootstrap runs once per document
   * load, so a dismissal that happens afterwards must mark the document itself
   * or a client-side return to `/` repaints the box (measured in review).
   */
  it('marks <html> with the same attribute and value the bootstrap uses', () => {
    expect(document.documentElement.hasAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)).toBe(false)

    markAccountNoticeDismissedOnDocument()

    expect(document.documentElement.getAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)).toBe(
      DISMISSED_VALUE
    )
  })

  it('is idempotent', () => {
    markAccountNoticeDismissedOnDocument()
    markAccountNoticeDismissedOnDocument()
    expect(document.documentElement.getAttribute(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)).toBe(
      DISMISSED_VALUE
    )
  })
})

describe('wasAccountNoticeDismissed', () => {
  it('is false when the key was never written', () => {
    expect(wasAccountNoticeDismissed()).toBe(false)
  })

  it('is true for exactly the stored sentinel', () => {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, '1')
    expect(wasAccountNoticeDismissed()).toBe(true)
  })

  /**
   * ⚠️ THE TRUTHINESS GUARD. `'true'`, `'0'` and a timestamp are all TRUTHY
   * strings, so a `Boolean(raw)` implementation passes every other test in this
   * file and fails only these. `'0'` is included because it is the value a
   * naive "store a boolean" refactor would write for NOT-dismissed — under
   * truthiness that would hide the box for a user who never dismissed it.
   *
   * The timestamp case is the concrete migration hazard: if someone "aligns"
   * this with `InstallPrompt` and starts writing `Date.now()`, this side must
   * refuse it rather than silently accept a value the bootstrap also has to
   * agree about.
   */
  it.each([
    ['empty string', ''],
    ['the string "0"', '0'],
    ['the string "true"', 'true'],
    ['the string "false"', 'false'],
    ['an InstallPrompt-style timestamp', '1757000000000'],
    ['whitespace-padded sentinel', ' 1 '],
    ['a JSON blob', '{"dismissed":true}'],
  ])('is false for %s', (_label, raw) => {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, raw)
    expect(wasAccountNoticeDismissed()).toBe(false)
  })

  it('fails open (false, no throw) when the store throws on read (AC-3)', () => {
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: access denied')
    })
    expect(() => wasAccountNoticeDismissed()).not.toThrow()
    expect(wasAccountNoticeDismissed()).toBe(false)
  })
})

describe('rememberAccountNoticeDismissal', () => {
  it('writes the sentinel under the dedicated key', () => {
    rememberAccountNoticeDismissal()
    expect(localStorage.getItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY)).toBe('1')
  })

  it('round-trips with the reader', () => {
    expect(wasAccountNoticeDismissed()).toBe(false)
    rememberAccountNoticeDismissal()
    expect(wasAccountNoticeDismissed()).toBe(true)
  })

  it('swallows a blocked/full store rather than throwing (AC-3)', () => {
    vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => rememberAccountNoticeDismissal()).not.toThrow()
  })
})
