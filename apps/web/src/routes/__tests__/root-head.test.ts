import { afterEach, describe, expect, it, vi } from 'vitest'
import { COUNTERDEV_SCRIPT_SRC } from '../../lib/analytics/counter'
import { Route } from '../__root'

// If head() ever turned async, absence assertions would pass on undefined, so that case throws.
function rootHead() {
	const head = Route.options.head?.({} as never)
	if (head instanceof Promise) throw new Error('__root head() is async: read it with await')
	return head
}

function headScripts() {
	return rootHead()?.scripts ?? []
}

function headMeta() {
	return rootHead()?.meta ?? []
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('__root head() analytics wiring', () => {
	it('emits exactly one counter.dev script (with data-id) when the id is set', () => {
		vi.stubEnv('VITE_COUNTERDEV_ID', 'site-test-123')
		const scripts = headScripts()
		const counterScripts = scripts.filter((s) => s?.src === COUNTERDEV_SCRIPT_SRC)
		expect(counterScripts).toEqual([
			{ src: COUNTERDEV_SCRIPT_SRC, 'data-id': 'site-test-123', defer: true },
		])
	})

	it('emits no counter.dev script when the id is unset', () => {
		vi.stubEnv('VITE_COUNTERDEV_ID', '')
		const scripts = headScripts()
		expect(scripts.some((s) => s?.src === COUNTERDEV_SCRIPT_SRC)).toBe(false)
	})
})

// Both sides lowercased: the title has the subtitle in lowercase, the description capitalised.
describe('__root head() subtitle metadata', () => {
	const SUBTITLE = 'track your finances with privacy and control'
	const RETIRED_TAGLINE = 'minds its own business'
	const OLD_TAGLINE = 'never sees your money'

	// Exact pins: containment let extra copy and casing regressions through.
	const EXPECTED_TITLE = 'Longhand Budget — track your finances with privacy and control'
	const EXPECTED_DESCRIPTION =
		'Track your finances with privacy and control — income, expenses, savings, and long-term plans. The free tier runs entirely in your browser, so your financial data never leaves your device.'

	it('the document title reads exactly the expected title', () => {
		const meta = headMeta()
		const titleEntry = meta.find((m) => m !== undefined && 'title' in m) as
			| { title?: string }
			| undefined
		expect(titleEntry?.title).toBe(EXPECTED_TITLE)
		// Kept alongside the exact pin so a failure names which retired line returned.
		expect(titleEntry?.title?.toLowerCase()).toContain(SUBTITLE)
		expect(titleEntry?.title?.toLowerCase()).not.toContain(RETIRED_TAGLINE)
		expect(titleEntry?.title?.toLowerCase()).not.toContain(OLD_TAGLINE)
	})

	it('the meta description is present and reads exactly the expected description', () => {
		const meta = headMeta()
		const description = meta.find((m) => m?.name === 'description') as
			| { content?: string }
			| undefined
		expect(description).toBeDefined()
		expect(description?.content).toBe(EXPECTED_DESCRIPTION)
		expect(description?.content?.toLowerCase()).toContain(SUBTITLE)
		expect(description?.content?.toLowerCase()).not.toContain(RETIRED_TAGLINE)
		expect(description?.content?.toLowerCase()).not.toContain(OLD_TAGLINE)
	})

	it('the document title carries the formal "Longhand Budget" brand, not the retired one', () => {
		const meta = headMeta()
		const titleEntry = meta.find((m) => m !== undefined && 'title' in m) as
			| { title?: string }
			| undefined
		expect(titleEntry?.title).toContain('Longhand Budget')
		expect(titleEntry?.title).not.toContain('SoluBudget')
	})
})
