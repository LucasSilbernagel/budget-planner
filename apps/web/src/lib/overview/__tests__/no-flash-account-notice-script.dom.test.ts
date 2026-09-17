/**
 * Pre-paint bootstrap for the Overview "No account needed" notice
 * (story 55.1, AC-4).
 *
 * ⚠️ WHY THIS SCRIPT EXISTS AT ALL. AC-3 requires the React-side read to happen
 * inside an effect, so the server render and the first client render agree (the
 * server cannot know a per-browser dismissal, so both must render the box
 * PRESENT). Effects run after first paint — so applying the dismissal "once
 * React has mounted" is exactly what produces the flash AC-4 forbids: the box
 * paints, then vanishes, on every page load for a user who dismissed it. Only a
 * synchronous `<head>` script beats first paint.
 *
 * ⚠️ THE STRING IS WHAT SHIPS, SO THE STRING IS WHAT IS TESTED. These tests
 * execute the ACTUAL exported constant via `new Function` against a seeded
 * `localStorage` and assert the resulting `<html>` attribute — the behaviour,
 * not the source text. A test that exercised a parallel TypeScript
 * implementation could pass while the shipped bootstrap was broken. Same
 * discipline as `lib/nav/__tests__/no-flash-planner-visibility-script.dom.test.ts`.
 *
 * ⚠️ THE RULE UNDER TEST IS `=== '1'`, NOT TRUTHINESS, and it must match
 * `wasAccountNoticeDismissed` byte for byte. If the two readers of this key ever
 * disagree, a value one accepts and the other rejects hides the box pre-paint
 * and reveals it after hydration. The junk-value table below is deliberately
 * the same set that `account-notice-dismissal.dom.test.ts` asserts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE,
  ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY,
  DISMISSED_VALUE,
} from '../account-notice-dismissal'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../no-flash-account-notice-script'

const ATTRIBUTE = ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE

/**
 * Run the real bootstrap string the way the browser would.
 *
 * `new Function` rather than importing a testable helper on purpose: what ships
 * is the STRING.
 */
function runScript(): void {
  new Function(NO_FLASH_ACCOUNT_NOTICE_SCRIPT)()
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(ATTRIBUTE)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute(ATTRIBUTE)
})

describe('NO_FLASH_ACCOUNT_NOTICE_SCRIPT', () => {
  it('marks <html> when the notice was dismissed', () => {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, '1')
    runScript()
    expect(document.documentElement.getAttribute(ATTRIBUTE)).toBe('1')
  })

  it('leaves <html> unmarked when the key was never written', () => {
    runScript()
    expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false)
  })

  /**
   * The inversion guard. A truthiness implementation
   * (`if (localStorage.getItem(KEY))`) passes both tests above and fails only
   * here — and the resulting bug is the nastiest shape this feature has: the
   * bootstrap would hide the box pre-paint for a value that
   * `wasAccountNoticeDismissed` rejects, so React would then render it back in.
   */
  it.each([
    ['empty string', ''],
    ['the string "0"', '0'],
    ['the string "true"', 'true'],
    ['the string "false"', 'false'],
    ['an InstallPrompt-style timestamp', '1757000000000'],
    ['whitespace-padded sentinel', ' 1 '],
    ['a JSON blob', '{"dismissed":true}'],
  ])('leaves <html> unmarked for %s', (_label, raw) => {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, raw)
    runScript()
    expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false)
  })

  it('does not throw and does not mark <html> when the store throws', () => {
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: access denied')
    })
    expect(() => runScript()).not.toThrow()
    expect(document.documentElement.hasAttribute(ATTRIBUTE)).toBe(false)
  })

  /**
   * Single-source-of-truth guard. The script interpolates all three shared
   * constants, so a rename cannot leave the bootstrap reading the old key,
   * comparing the old sentinel, or setting the old attribute.
   *
   * ⚠️ The SENTINEL is the one that had to be fixed in code review: it was
   * previously a hard-coded `'1'` here, duplicating the module's private
   * constant, with a comment giving a false reason for it. Two readers of one
   * key that disagree produce a pre-paint/post-hydration inversion.
   */
  it('interpolates the shared key, sentinel and attribute — no duplicated literals', () => {
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY)
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain(`==='${DISMISSED_VALUE}'`)
  })

  it('is a self-contained IIFE with no bare identifiers to leak', () => {
    // The string is inlined into <head> ahead of every module, so it must not
    // declare globals or depend on any.
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT.startsWith('(function(){')).toBe(true)
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT.trimEnd().endsWith('})();')).toBe(true)
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain('try{')
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain('catch(e){}')
  })
})
