/**
 * The mount gate's module flag (story 38.2 review; moved below the browser by
 * story 84.4, FR137).
 *
 * Replaces `e2e/loading-state.spec.ts` › "a client-side navigation does not
 * re-enter the pending state". That test watched the DOM with a
 * MutationObserver while a router `Link` took the user back to `/`. The
 * mechanism it guarded is this hook: a gated page that mounts AFTER the first
 * one has resolved must start resolved, or every in-app navigation replays the
 * skeleton → content jump. A remount here is what a client navigation does to
 * the page component. The real router transition is the named loss.
 *
 * ⚠️ Every render is recorded, not just the settled value: the regression
 * (`useState(false)` per mount) is a ONE-RENDER flash that a settled-value
 * assertion cannot see, which is exactly why the e2e needed an observer.
 */

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetStoresHydratedForTests, useStoresHydrated } from '../useStoresHydrated'

let renders: boolean[] = []

function GatedPage() {
  const hydrated = useStoresHydrated()
  renders.push(hydrated)
  return <p>{hydrated ? 'figures' : 'skeleton'}</p>
}

beforeEach(() => {
  __resetStoresHydratedForTests()
  renders = []
})

describe('useStoresHydrated', () => {
  it('starts pending on the first mount, then resolves (the server-agreeing first render)', () => {
    const { container } = render(<GatedPage />)
    expect(renders[0], 'the first client render must match the server (pending)').toBe(false)
    expect(container).toHaveTextContent('figures')
  })

  it('a later mount (a client navigation) never renders the pending state', () => {
    const first = render(<GatedPage />)
    expect(first.container).toHaveTextContent('figures')
    first.unmount()

    renders = []
    const second = render(<GatedPage />)
    expect(renders, 'the remount rendered pending before resolving').not.toContain(false)
    expect(second.container).toHaveTextContent('figures')
  })
})
