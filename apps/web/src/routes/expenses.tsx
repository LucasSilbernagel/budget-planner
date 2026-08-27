import { createFileRoute } from '@tanstack/react-router'
import { ExpensesPage } from '../components/ExpensesPage'

export const Route = createFileRoute('/expenses')({
  head: () => ({
    meta: [
      { title: 'Expenses · Longhand Budget' },
      {
        name: 'description',
        content: 'Track and categorize your spending across any pay frequency.',
      },
    ],
  }),
  component: ExpensesPage,
})
