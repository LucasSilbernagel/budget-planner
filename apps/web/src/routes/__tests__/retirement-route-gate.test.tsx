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
    // Gone, not visually displaced: the gate is at the component, not CSS.
    expect(screen.queryByRole('heading', { name: /when can you retire\?/i })).toBeNull()
  })

  it.each([
    ['planner on', true, /when can you retire\?/i],
    ['planner hidden', false, /retirement planner is turned off/i],
  ])('the %s page is exactly one <main>', async (_state, show, heading) => {
    usePlannerVisibilityStore.setState({ showRetirementPlanner: show })
    renderWithRouter(<RetirementPage />)

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })
})
