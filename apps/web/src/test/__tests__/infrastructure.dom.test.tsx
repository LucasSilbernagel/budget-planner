import { describe, expect, it } from 'vitest'
import { makeIncomeSource, renderWithProviders, screen } from '@/test/utils'

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

		renderWithProviders(<IncomeBadge name={income.name} amount={income.amount} />)

		const badge = screen.getByTestId('income-badge')
		expect(badge).toBeInTheDocument()
		expect(badge).toHaveTextContent('Salary: 5000')
	})

	it('produces overridable fixtures from factories', () => {
		expect(makeIncomeSource().frequency).toBe('monthly')
		expect(makeIncomeSource({ frequency: 'weekly' }).frequency).toBe('weekly')
	})
})
