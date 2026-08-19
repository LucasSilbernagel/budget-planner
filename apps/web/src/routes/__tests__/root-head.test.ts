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

function headMeta() {
  return Route.options.head?.({} as never)?.meta ?? []
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

/**
 * Subtitle in page metadata (story 36-1, CONTENT-N — supersedes 27-4 / FR44).
 *
 * The <title> and a meta description must both carry the subtitle so the
 * social/search preview conveys what the app does. Asserted against the head
 * config directly (no SSR render needed).
 *
 * Both sides are lowercased before comparison: the title renders the subtitle in
 * lowercase after the em dash while the description opens with it capitalised,
 * so one constant covers both. Keep the lowercasing.
 */
describe('__root head() subtitle metadata (story 36-1)', () => {
  const SUBTITLE = 'track your finances with privacy and control'
  /** Retired by story 36-1. */
  const RETIRED_TAGLINE = 'minds its own business'
  /** Retired earlier, by story 27-4. Guarded so neither can creep back. */
  const OLD_TAGLINE = 'never sees your money'

  /**
   * AC-2 and AC-3 both say the copy "reads exactly" a given string, so both are
   * pinned with `toBe`, not `toContain`.
   *
   * Containment alone was too weak in two ways that a green run would have
   * hidden. A title of "Longhand Budget: track your finances with privacy and
   * control (now with ads!)" satisfies every containment and negative guard
   * below. And because the comparisons lowercase both sides, a casing
   * regression ("— Track Your Finances…") was invisible. The exact pins close
   * both, and they close AC-3's prose gap too: the degenerate splice
   * "…and control. Track income, expenses…" now fails here rather than shipping
   * green on a technicality.
   */
  const EXPECTED_TITLE = 'Longhand Budget — track your finances with privacy and control'
  const EXPECTED_DESCRIPTION =
    'Track your finances with privacy and control — income, expenses, savings, and long-term plans. The free tier runs entirely in your browser, so your financial data never leaves your device.'

  it('the document title reads exactly the AC-2 string', () => {
    const meta = headMeta()
    const titleEntry = meta.find((m) => 'title' in m) as { title?: string } | undefined
    expect(titleEntry?.title).toBe(EXPECTED_TITLE)
    // Kept alongside the exact pin: these name WHAT must not come back, so a
    // failure reads as "the retired tagline returned" rather than "a string
    // differs". The exact pin cannot say which retired line crept in.
    expect(titleEntry?.title?.toLowerCase()).toContain(SUBTITLE)
    expect(titleEntry?.title?.toLowerCase()).not.toContain(RETIRED_TAGLINE)
    expect(titleEntry?.title?.toLowerCase()).not.toContain(OLD_TAGLINE)
  })

  it('the meta description is present and reads exactly the AC-3 string', () => {
    const meta = headMeta()
    const description = meta.find((m) => m.name === 'description') as
      | { content?: string }
      | undefined
    expect(description).toBeDefined()
    expect(description?.content).toBe(EXPECTED_DESCRIPTION)
    expect(description?.content?.toLowerCase()).toContain(SUBTITLE)
    expect(description?.content?.toLowerCase()).not.toContain(RETIRED_TAGLINE)
    expect(description?.content?.toLowerCase()).not.toContain(OLD_TAGLINE)
  })

  /**
   * Brand pin (story brand-1, AC-1/AC-2). The naming architecture specifies the
   * meta title as "Longhand Budget — <subtitle>", i.e. the FORMAL form, not the
   * short "Longhand". Before brand-1 the title had a tagline guard but no brand
   * guard at all, so a rename could silently half-land here.
   *
   * Story 36-1 swapped the copy after the em dash and left the brand token
   * untouched, which is exactly the split this pin exists to keep honest: FR43
   * governs the brand half, FR44-as-amended governs the copy half.
   */
  it('the document title carries the formal "Longhand Budget" brand, not the retired one', () => {
    const meta = headMeta()
    const titleEntry = meta.find((m) => 'title' in m) as { title?: string } | undefined
    expect(titleEntry?.title).toContain('Longhand Budget')
    expect(titleEntry?.title).not.toContain('SoluBudget')
  })
})
