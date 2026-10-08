import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePlannerVisibilityStore } from '../../../stores/plannerVisibilityStore'
import { RetirementVisibilityToggle } from '../retirement-visibility-toggle'

const toggle = () => screen.getByRole('switch', { name: /show retirement planner/i })

beforeEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
  localStorage.clear()
})

afterEach(() => {
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
})

describe('RetirementVisibilityToggle', () => {
  it('renders a switch that is checked by default (AC-1)', () => {
    render(<RetirementVisibilityToggle />)
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  it('reflects a hidden planner as unchecked', () => {
    usePlannerVisibilityStore.setState({ showRetirementPlanner: false })
    render(<RetirementVisibilityToggle />)
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
  })

  it('writes the store when activated, and reflects it back', async () => {
    const user = userEvent.setup()
    render(<RetirementVisibilityToggle />)

    await user.click(toggle())
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(false)
    expect(toggle()).toHaveAttribute('aria-checked', 'false')

    await user.click(toggle())
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  // A settings test filters every switch on /dark mode/i, so this name must not match.
  it('does not collide with the dark-mode switch name', () => {
    render(<RetirementVisibilityToggle />)
    const name = toggle().getAttribute('aria-label') ?? toggle().textContent ?? ''
    expect(name).not.toMatch(/dark mode/i)
  })

  it('keeps its accessible name clean of the decorative track', () => {
    const { container } = render(<RetirementVisibilityToggle />)
    expect(screen.getByRole('switch', { name: 'Show Retirement planner' })).toBeInTheDocument()
    const hidden = container.querySelectorAll('[aria-hidden="true"]')
    expect(hidden).toHaveLength(1)
    expect(hidden[0].textContent).toBe('')
  })

  it('wires aria-describedby only when the host supplies a description id', () => {
    const { unmount } = render(<RetirementVisibilityToggle />)
    expect(toggle()).not.toHaveAttribute('aria-describedby')
    unmount()

    render(<RetirementVisibilityToggle describedBy="desc-1" />)
    expect(toggle()).toHaveAttribute('aria-describedby', 'desc-1')
  })
})
