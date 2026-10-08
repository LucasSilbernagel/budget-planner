/**
 * Anchored on both ends only: jsdom puts a space before the comma that Chrome may not.
 * `getByRole` matches the whole name, so pair every absence probe with a positive control.
 */
import { within } from '@testing-library/react'
import { expect } from 'vitest'

export function lockedName(title: string): RegExp {
	const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(`^${escaped}\\b.*\\bpremium\\s*,\\s*locked$`, 'i')
}

export const ANY_LOCKED_NAME = /\bpremium\s*,\s*locked$/i

function accessibleNameOf(button: HTMLElement): string {
	let name: string | null = null
	within(button.parentElement ?? document.body).queryAllByRole('button', {
		name: (computed, node) => {
			if (node === button) name = computed
			return false
		},
	})
	if (name === null) throw new Error('not an exposed button')
	return name
}

export function expectLockedRowsNamedByVisibleText(container: HTMLElement): HTMLElement[] {
	const rows = Array.from(
		container.querySelectorAll<HTMLElement>('[data-testid="premium-gate-locked"]')
	)
	for (const row of rows) {
		expect(row).not.toHaveAttribute('aria-label')
		expect(row).not.toHaveAttribute('aria-labelledby')
		const visibleTexts = Array.from(row.querySelectorAll('*'))
			.filter((el) => el.closest('[aria-hidden="true"], .sr-only') === null)
			.flatMap((el) => Array.from(el.childNodes))
			.filter((node) => node.nodeType === Node.TEXT_NODE)
			.map((node) => (node.textContent ?? '').trim())
			.filter(Boolean)
		const name = accessibleNameOf(row)
		expect(visibleTexts.length, `${name}: has a title and a description`).toBeGreaterThanOrEqual(3)
		expect(name.startsWith(visibleTexts[0] as string), `${name}: starts with its title`).toBe(true)
		for (const text of visibleTexts) expect(name).toContain(text)
		expect(name).toMatch(ANY_LOCKED_NAME)
	}
	return rows
}
