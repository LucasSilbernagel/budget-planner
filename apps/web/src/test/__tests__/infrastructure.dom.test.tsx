import { describe, it, expect } from 'vitest'
import { renderWithProviders, screen, makeIncomeSource } from '@/test/utils'

/**
 * Verifies the component-testing pipeline (AC-1): jsdom environment +
 * React Testing Library + @testing-library/jest-dom matchers + the shared
 * `renderWithProviders` helper and data factories.
 */
function IncomeBadge({ name, amount }: { name: string; amount: number }) {
  return (
    <span data-testid="income-badge">
      {name}: {amount}
    </span>
  )
}

describe('component test infrastructure', () => {
  it('renders a component in jsdom and applies jest-dom matchers', () => {
    const income = makeIncomeSource({ name: 'Salary', amount: 5000 })

    renderWithProviders(
      <IncomeBadge name={income.name} amount={income.amount} />,
    )

    const badge = screen.getByTestId('income-badge')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('Salary: 5000')
  })

  it('produces overridable fixtures from factories', () => {
    expect(makeIncomeSource().frequency).toBe('monthly')
    expect(makeIncomeSource({ frequency: 'weekly' }).frequency).toBe('weekly')
  })
})
