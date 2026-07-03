/**
 * Root-route head wiring for counter.dev analytics (story 10-1, AC-1 / AC-4).
 *
 * The pure `buildAnalyticsScripts()` helper is unit-tested in isolation
 * (lib/analytics/__tests__/counter.test.ts); this guards the integration seam
 * that those tests can't see — that the helper is actually wired into the root
 * route's `head().scripts`, so the counter.dev `<script data-id>` is emitted by
 * `<Scripts />` (and omitted when the id is unset). Asserting the head config
 * here catches a regression such as the `scripts` key being dropped from
 * `__root.tsx` without needing a full SSR render (that "renders exactly once"
 * property is a TanStack `<Scripts />` guarantee, additionally smoke-verified
 * via curl in the story's Debug Log).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { COUNTERDEV_SCRIPT_SRC } from '../../lib/analytics/counter'
import { Route } from '../__root'

function headScripts() {
  return Route.options.head?.({} as never)?.scripts ?? []
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('__root head() analytics wiring', () => {
  it('emits exactly one counter.dev script (with data-id) when the id is set', () => {
    vi.stubEnv('VITE_COUNTERDEV_ID', 'site-test-123')
    const scripts = headScripts()
    const counterScripts = scripts.filter((s) => s.src === COUNTERDEV_SCRIPT_SRC)
    expect(counterScripts).toEqual([{ src: COUNTERDEV_SCRIPT_SRC, 'data-id': 'site-test-123' }])
  })

  it('emits no counter.dev script when the id is unset', () => {
    vi.stubEnv('VITE_COUNTERDEV_ID', '')
    const scripts = headScripts()
    expect(scripts.some((s) => s.src === COUNTERDEV_SCRIPT_SRC)).toBe(false)
  })
})
