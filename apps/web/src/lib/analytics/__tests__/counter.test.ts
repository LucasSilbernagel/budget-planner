/**
 * counter.dev analytics helper tests (story 10-1, AC-5 / FR28).
 *
 * Covers: the SSR head `scripts` entry is built with the correct src + data-id
 * when the site id is configured, and degrades to `[]` (no script emitted) when
 * the id is unset or whitespace-only. The site id is read at call time (not
 * module scope) so tests can stub it via `vi.stubEnv` — mirrors the Formspark
 * form-id pattern.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { COUNTERDEV_SCRIPT_SRC, buildAnalyticsScripts } from '../counter'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildAnalyticsScripts', () => {
  it('returns the counter.dev script entry when the site id is configured', () => {
    vi.stubEnv('VITE_COUNTERDEV_ID', 'site-test-123')
    expect(buildAnalyticsScripts()).toEqual([
      { src: COUNTERDEV_SCRIPT_SRC, 'data-id': 'site-test-123' },
    ])
  })

  it('trims a surrounding-whitespace site id', () => {
    vi.stubEnv('VITE_COUNTERDEV_ID', '  site-test-123  ')
    expect(buildAnalyticsScripts()).toEqual([
      { src: COUNTERDEV_SCRIPT_SRC, 'data-id': 'site-test-123' },
    ])
  })

  it('returns [] when the site id is unset', () => {
    vi.stubEnv('VITE_COUNTERDEV_ID', '')
    expect(buildAnalyticsScripts()).toEqual([])
  })

  it('returns [] when the site id is whitespace-only', () => {
    vi.stubEnv('VITE_COUNTERDEV_ID', '   ')
    expect(buildAnalyticsScripts()).toEqual([])
  })
})
