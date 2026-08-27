import { createFileRoute } from '@tanstack/react-router'
import { SavingsPage } from '../components/SavingsPage'

export const Route = createFileRoute('/savings')({
  head: () => ({
    meta: [
      { title: 'Savings · Longhand Budget' },
      {
        name: 'description',
        content:
          'Track and manage your savings targets, and see how your monthly capacity is allocated.',
      },
    ],
  }),
  component: SavingsPage,
})
