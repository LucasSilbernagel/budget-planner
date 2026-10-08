// @vitest-environment node
// /savings must never write to the balance store. A spy cannot prove a removed write path stays
// removed, so this reads raw source (stripping would blank `${}` interpolations, which are code).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SAVINGS_PAGE = join(__dirname, '..', 'SavingsPage.tsx')

// `useBalanceStore` is a forward guard; it would also trip on a legitimate future read.
const WRITE_PATHS = ['updateBalanceEntry', 'useBalanceActions', 'useBalanceStore']

describe('SavingsPage — no balance-store writes (Story 47.1, AC-8)', () => {
	it('names no balance-store write path anywhere in the file', () => {
		const source = readFileSync(SAVINGS_PAGE, 'utf8')
		for (const symbol of WRITE_PATHS) {
			expect(source).not.toContain(symbol)
		}
	})

	it('still names its READ path — the guard must not have banned the data source', () => {
		// Without this, a guard pointed at the wrong path passes vacuously.
		const source = readFileSync(SAVINGS_PAGE, 'utf8')
		expect(source).toContain('useInvestmentEntries')
		expect(source).toContain('solveAutomaticAllocations')
	})

	it('scans template-literal interpolations, where a write would most plausibly hide', () => {
		// A stripper that blanked `${…}` went green on exactly this shape.
		const source = readFileSync(SAVINGS_PAGE, 'utf8')
		expect(source).toMatch(/`[^`]*\$\{/)
		const interpolations = source.match(/\$\{[^}]*\}/g) ?? []
		expect(interpolations.length).toBeGreaterThan(0)
		for (const fragment of interpolations) {
			for (const symbol of WRITE_PATHS) {
				expect(fragment).not.toContain(symbol)
			}
		}
	})
})
