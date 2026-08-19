/**
 * RetirementVisibilityToggle tests (story 35.2, FR55, AC-1 / AC-6).
 *
 * The control is the only way a user turns the Retirement planner off, so these
 * pin its switch semantics (`role="switch"` + `aria-checked` in BOTH states),
 * its default-on state, and that activating it actually writes the store rather
 * than only repainting itself.
 */

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
    // The STORE changed — not merely the control's own local appearance.
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(false)
    expect(toggle()).toHaveAttribute('aria-checked', 'false')

    await user.click(toggle())
    expect(usePlannerVisibilityStore.getState().showRetirementPlanner).toBe(true)
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  /**
   * ⚠️ Anti-collision guard. `settings-page.test.tsx` counts dark-mode switches
   * by filtering EVERY `role="switch"` on `/dark mode/i` over
   * `aria-label`/`textContent`. An accessible name here containing that phrase
   * would break that unrelated, correct test — so pin the name's shape here,
   * where the cause would be obvious, rather than leaving a confusing failure
   * in the settings suite.
   */
  it('does not collide with the dark-mode switch name', () => {
    render(<RetirementVisibilityToggle />)
    const name = toggle().getAttribute('aria-label') ?? toggle().textContent ?? ''
    expect(name).not.toMatch(/dark mode/i)
  })

  /**
   * ⚠️ Assert the NAME, not just the count of hidden nodes. The first version of
   * this test only counted `[aria-hidden="true"]` elements — which would pass if
   * `aria-hidden` sat on the LABEL span instead of the decorative track,
   * destroying the very accessible name the test claims to protect. Found in
   * review: a test whose name is a claim its assertions do not make.
   */
  it('keeps its accessible name clean of the decorative track', () => {
    const { container } = render(<RetirementVisibilityToggle />)
    // The name resolves — so whatever is aria-hidden is not the label.
    expect(screen.getByRole('switch', { name: 'Show Retirement planner' })).toBeInTheDocument()
    // ...and the track really is the hidden node.
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
