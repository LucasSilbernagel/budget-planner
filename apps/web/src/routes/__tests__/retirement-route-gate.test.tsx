/**
 * The `/retirement` route's on/off branch (story 35.2, AC-5 / AC-6).
 *
 * ⚠️ THIS FILE EXISTS BECAUSE ITS TASK CHECKBOX WAS TICKED WITHOUT IT. The dev
 * record claimed a unit test for "the route's on/off branch"; the Acceptance
 * Auditor grepped and found none — the branch had e2e coverage only. AC-5 was
 * genuinely met, but the task claim was not, which is this project's documented
 * failure mode: gate NUMBERS stay honest because they are measured, AC verdicts
 * inflate because they are judged.
 *
 * The route component is reached through `Route.options.component` rather than a
 * separate export, so the assertion covers the gate exactly as the router will
 * invoke it — not a re-implementation of it.
 */

import { renderWithRouter, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlannerVisibilityStore } from '../../stores/plannerVisibilityStore'
import { Route } from '../retirement'

const RetirementPage = Route.options.component as () => React.ReactElement

beforeEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  localStorage.clear()
})

afterEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
})

describe('the /retirement route gate', () => {
  it('renders the planner when the preference is on', async () => {
    renderWithRouter(<RetirementPage />)
    expect(
      await screen.findByRole('heading', { name: /when can you retire\?/i })
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /is turned off/i })).toBeNull()
  })

  it('renders the off-state instead of the planner when the preference is off', async () => {
    usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
    renderWithRouter(<RetirementPage />)

    expect(
      await screen.findByRole('heading', { name: /retirement planner is turned off/i })
    ).toBeInTheDocument()
    // The planner itself must be GONE, not merely visually displaced — the
    // whole point of gating at the component rather than hiding with CSS.
    expect(screen.queryByRole('heading', { name: /when can you retire\?/i })).toBeNull()
  })
})
