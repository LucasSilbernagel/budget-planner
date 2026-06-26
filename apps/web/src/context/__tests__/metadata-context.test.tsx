/**
 * MetadataProvider tests (story 4-12, AC-1 / FR14, UX-DR8).
 *
 * AC-1 demands: client metadata captured from URL params on load, exposed to
 * components, used for analytics only, with NO cookies or localStorage tracking.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MetadataProvider, useAnalytics, useMetadata } from '../metadata-context'

function setUrl(search: string): void {
  // jsdom reflects history changes into window.location.search.
  window.history.replaceState({}, '', `/${search}`)
}

function MetadataProbe() {
  const metadata = useMetadata()
  return <div data-testid="source">{metadata.source ?? 'none'}</div>
}

function AnalyticsProbe() {
  const analytics = useAnalytics()
  const events = analytics.getEvents()
  const last = events[events.length - 1]
  return (
    <div data-testid="analytics">
      {events.length}:{last?.name ?? 'none'}:{last?.metadata.source ?? 'none'}
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  // Reset cookies between tests.
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim()
    if (name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT`
    }
  }
})

afterEach(() => {
  setUrl('')
})

describe('MetadataProvider', () => {
  it('AC-1: captures metadata from the landing URL and exposes it', async () => {
    setUrl('?utm_source=newsletter&utm_campaign=launch')
    render(
      <MetadataProvider>
        <MetadataProbe />
      </MetadataProvider>
    )
    await waitFor(() => expect(screen.getByTestId('source')).toHaveTextContent('newsletter'))
  })

  it('AC-1: feeds the captured metadata into the analytics service', async () => {
    setUrl('?utm_source=twitter')
    render(
      <MetadataProvider>
        <AnalyticsProbe />
      </MetadataProvider>
    )
    // A page_view event is recorded carrying the captured source.
    await waitFor(() =>
      expect(screen.getByTestId('analytics')).toHaveTextContent('1:page_view:twitter')
    )
  })

  it('AC-1: writes NO cookies and NO localStorage for tracking', async () => {
    setUrl('?utm_source=newsletter')
    render(
      <MetadataProvider>
        <MetadataProbe />
      </MetadataProvider>
    )
    await waitFor(() => expect(screen.getByTestId('source')).toHaveTextContent('newsletter'))
    expect(document.cookie).toBe('')
    expect(localStorage.length).toBe(0)
  })

  it('exposes empty metadata when no tracked params are present', async () => {
    setUrl('?foo=bar')
    render(
      <MetadataProvider>
        <MetadataProbe />
      </MetadataProvider>
    )
    await waitFor(() => expect(screen.getByTestId('source')).toHaveTextContent('none'))
  })

  it('throws when the hooks are used outside the provider', () => {
    // Silence the expected React error boundary console noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<MetadataProbe />)).toThrow(/MetadataProvider/)
    spy.mockRestore()
  })
})
