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

  it('says the expense form stopped asking too, not only the navigation (71.1, FR113)', async () => {
    renderWithRouter(<RetirementDisabledNotice />)
    expect(
      await screen.findByText(/the expense form no longer asks about retirement/i)
    ).toBeInTheDocument()
  })

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
