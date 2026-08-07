import { describe, expect, it } from 'vitest'
// @ts-expect-error — pwa.config.mjs is plain ESM at the app root with no types.
import { pwaManifest } from '../../pwa.config.mjs'

/**
 * PWA identity pins (story brand-1, AC-3).
 *
 * Before brand-1 the manifest had NO test coverage at all: `name`, `short_name`
 * and `description` could have been left on the retired brand, or half-renamed,
 * with the whole suite still green. The install prompt's own copy is pinned in
 * `components/pwa/__tests__/InstallPrompt.test.tsx`, but nothing tied that copy
 * to the manifest the browser actually installs from.
 *
 * The two must agree. `short_name` is what the OS prints under the home-screen
 * icon, so if the prompt says "Install Longhand" and the manifest short_name is
 * anything else, the user is told to install one product and receives another.
 */
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
