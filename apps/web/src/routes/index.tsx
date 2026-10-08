import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '../components/HomePage'

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Overview · Longhand Budget' },
      {
        name: 'description',
        content:
          'Your income, expenses, savings and net worth at a glance, with category breakdowns for any period.',
      },
    ],
  }),
  component: HomePage,
})
