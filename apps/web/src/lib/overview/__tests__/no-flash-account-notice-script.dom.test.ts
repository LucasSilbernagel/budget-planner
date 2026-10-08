import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE,
  ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY,
  DISMISSED_VALUE,
} from '../account-notice-dismissal'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../no-flash-account-notice-script'

const ATTRIBUTE = ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE

/** Runs the shipped string itself, not a parallel TypeScript implementation. */
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

  /** A truthiness implementation passes the tests above and fails only here. */
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

  it('interpolates the shared key, sentinel and attribute — no duplicated literals', () => {
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY)
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain(ACCOUNT_NOTICE_DISMISSED_ATTRIBUTE)
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain(`==='${DISMISSED_VALUE}'`)
  })

  it('is a self-contained IIFE with no bare identifiers to leak', () => {
    // Inlined into <head> ahead of every module, so it must not declare globals or depend on any.
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT.startsWith('(function(){')).toBe(true)
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT.trimEnd().endsWith('})();')).toBe(true)
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain('try{')
    expect(NO_FLASH_ACCOUNT_NOTICE_SCRIPT).toContain('catch(e){}')
  })
})
