import { createFileRoute } from '@tanstack/react-router'
import { IncomePage } from '../components/IncomePage'

export const Route = createFileRoute('/income')({
  head: () => ({
    meta: [
      { title: 'Income · Longhand Budget' },
      {
        name: 'description',
        content: 'Manage your income streams and track your earnings across any pay frequency.',
      },
    ],
  }),
  component: IncomePage,
})
