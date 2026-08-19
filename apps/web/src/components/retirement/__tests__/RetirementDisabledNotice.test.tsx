/**
 * RetirementDisabledNotice tests (story 35.2, FR55, AC-5 / AC-6 / AC-7).
 *
 * The off-state must be an EXIT, not a dead end: it explains what happened, says
 * plainly that nothing was deleted, and offers a working way back. A panel that
 * merely says "turned off" would strand a user who arrived here from the in-app
 * docs link or a bookmark.
 */

import { renderWithRouter, screen } from '@/test/utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
import { RetirementDisabledNotice } from '../RetirementDisabledNotice'

beforeEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
  localStorage.clear()
})

afterEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
})

describe('RetirementDisabledNotice', () => {
  it('explains that the planner is off and where it was turned off', async () => {
    renderWithRouter(<RetirementDisabledNotice />)

    expect(
      await screen.findByRole('heading', { name: /retirement planner is turned off/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/you hid this planner in settings/i)).toBeInTheDocument()
  })

  /**
   * AC-7's user-facing half. The control that leads here sits on the same
   * Settings page as "Clear local data", so the copy must actively deny data
   * loss rather than leave the user to infer it.
   */
  it('states plainly that nothing was deleted', async () => {
    renderWithRouter(<RetirementDisabledNotice />)
    expect(await screen.findByText(/nothing was deleted/i)).toBeInTheDocument()
  })

  it('re-enables the planner from its own button (AC-6)', async () => {
    const user = userEvent.setup()
    renderWithRouter(<RetirementDisabledNotice />)

    await user.click(await screen.findByRole('button', { name: /turn the planner back on/i }))

    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
  })

  it('offers a link to Settings as a second way back', async () => {
    renderWithRouter(<RetirementDisabledNotice />)
    expect(await screen.findByRole('link', { name: /go to settings/i })).toHaveAttribute(
      'href',
      '/settings'
    )
  })
})
