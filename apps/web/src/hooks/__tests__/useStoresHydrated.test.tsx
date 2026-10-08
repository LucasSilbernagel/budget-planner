/**
 * Every render is recorded: the regression is a one-render flash that a settled-value assertion
 * cannot see.
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
