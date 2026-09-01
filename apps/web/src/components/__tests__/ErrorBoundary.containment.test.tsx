/**
 * ErrorBoundary containment (story 51.1, AC-18 — re-homed from a deleted suite).
 *
 * ⚠️ WHY THIS FILE EXISTS. Story 51.1 deleted `SavingsChart.error-boundary.test.tsx`
 * along with the Savings chart. That suite's docblock recorded something the deletion
 * nearly threw away:
 *
 *   "THIS IS THE FIRST TEST IN THE REPO THAT MOUNTS A THROWING CHILD IN AN
 *    ErrorBoundary. Nine chart call sites are wrapped and three test files mention
 *    ErrorBoundary, but all three assert the OPPOSITE direction — that the fallback
 *    is NOT reached. Nothing proved the boundary actually contains anything. This does."
 *
 * The VEHICLE was chart-specific; the COVERAGE was not. `ErrorBoundary` still ships and
 * still wraps live call sites that have nothing to do with the Savings chart —
 * `HomePage.tsx:1167,1228`, `categories/CategoryBreakdown.tsx:495`,
 * `forecasting/projection-chart.tsx:191`, and `sync/SyncProvider.tsx:123-132`, where a
 * failed lazy chunk is meant to degrade to "continue without sync" rather than take the
 * page down (`lib/lazy-with-retry.ts:29-30` delegates the un-retryable case to it).
 *
 * ⚠️ The three surviving mentions of `ErrorBoundary` in tests all assert the fallback is
 * NOT reached (`HomePage.pie-labels.chart-wiring.test.tsx:70` is only a comment;
 * `RetirementAccumulationPlanner.test.tsx:1283,1319,1333`). A suite of
 * "the boundary was not triggered" assertions passes perfectly against a boundary that
 * cannot catch anything at all. This file is the positive direction.
 *
 * ⚠️ It deliberately does NOT depend on any chart, so the next chart deletion cannot
 * take it away again.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../ErrorBoundary'

/** Throws during render, i.e. inside the boundary — where a real failure surfaces. */
function Exploding({ message }: { message: string }): never {
  throw new Error(message)
}

describe('ErrorBoundary — containment (story 51.1)', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React logs the caught error itself; silence it but keep the spy assertable.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('renders its default fallback instead of propagating the throw (AC-18)', () => {
    // ⚠️ The anti-vacuity partner: if the child did NOT throw, this render would
    // simply succeed and every assertion below would still pass on the happy path.
    // `console.error` having been called is what proves a throw was actually caught.
    render(
      <ErrorBoundary>
        <Exploding message="a plain rendering failure occurred here" />
      </ErrorBoundary>
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(consoleError.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('renders a provided fallback in place of the default (AC-18)', () => {
    render(
      <ErrorBoundary fallback={<p>sync unavailable</p>}>
        <Exploding message="a plain rendering failure occurred here" />
      </ErrorBoundary>
    )

    expect(screen.getByText('sync unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })

  it('renders children untouched when nothing throws (the positive control)', () => {
    render(
      <ErrorBoundary>
        <p>the real content</p>
      </ErrorBoundary>
    )

    expect(screen.getByText('the real content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('strips file locations and stack fragments out of the displayed message (AC-18)', () => {
    // `sanitizeErrorMessage` (`ErrorBoundary.tsx:24-46`) exists so a user-visible
    // <details> never leaks a path or a frame. Nothing asserted this before.
    render(
      <ErrorBoundary>
        <Exploding message="database write failed at handleSubmit ( SavingsPage.tsx:1024:17" />
      </ErrorBoundary>
    )

    const details = screen.getByText(/database write failed/)
    expect(details.textContent).not.toMatch(/\.tsx:\d+:\d+/)
    expect(details.textContent).not.toMatch(/at \w+ \(/)
  })

  it('falls back to a generic message when sanitising leaves too little (AC-18)', () => {
    // A message that is ENTIRELY a stack fragment sanitises down to under 10 chars.
    render(
      <ErrorBoundary>
        <Exploding message="at boot (" />
      </ErrorBoundary>
    )

    expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument()
  })
})
