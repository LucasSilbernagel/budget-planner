/**
 * PremiumLockBadge tests (story 7-2, FR24).
 *
 * Purely presentational: it must show a visible "Premium" label so the locked
 * state is discoverable (not hidden), and render no interactive elements.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PremiumLockBadge } from '../PremiumLockBadge'

describe('PremiumLockBadge', () => {
  it('shows a visible "Premium" label', () => {
    render(<PremiumLockBadge />)
    expect(screen.getByText('Premium')).toBeInTheDocument()
  })

  it('renders no interactive elements (it is decorative)', () => {
    render(<PremiumLockBadge />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('applies extra className to the container', () => {
    const { container } = render(<PremiumLockBadge className="ml-2" />)
    expect(container.firstChild).toHaveClass('ml-2')
  })
})
