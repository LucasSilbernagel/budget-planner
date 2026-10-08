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
		expect(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY).not.toBe('bp-pwa-install-dismissed')
	})

	/**
	 * Script-injection guard: these are interpolated into the inline bootstrap, and the CSP hash would
	 * drift along with a broken string.
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

	/** Truthy junk values: a `Boolean(raw)` implementation fails only these. */
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
