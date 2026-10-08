import { describe, expect, it } from 'vitest'
// @ts-expect-error — pwa.config.mjs is plain ESM at the app root with no types.
import { pwaManifest } from '../../pwa.config.mjs'

// `short_name` is what the OS prints under the icon, so it must match the install prompt.
describe('PWA manifest identity (story brand-1, AC-3)', () => {
	const manifest = pwaManifest as {
		name: string
		short_name: string
		description: string
	}

	it('uses the formal brand for `name` and the short form for `short_name`', () => {
		expect(manifest.name).toBe('Longhand Budget')
		expect(manifest.short_name).toBe('Longhand')
	})

	it('carries the new brand in the description', () => {
		expect(manifest.description).toContain('Longhand Budget')
	})

	it('retains no retired brand string anywhere in the manifest identity', () => {
		const identity = [manifest.name, manifest.short_name, manifest.description].join(' ')
		expect(identity).not.toContain('SoluBudget')
		expect(identity).not.toContain('Budget Planner')
	})
})
