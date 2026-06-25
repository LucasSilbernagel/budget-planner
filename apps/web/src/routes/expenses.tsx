import { createFileRoute } from '@tanstack/react-router'
import { ExpensesPage } from '../components/ExpensesPage'

export const Route = createFileRoute('/expenses')({
  component: ExpensesPage,
})
