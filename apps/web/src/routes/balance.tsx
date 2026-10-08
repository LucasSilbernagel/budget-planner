import { createFileRoute } from '@tanstack/react-router'
import { BalancePage } from '../components/BalancePage'

export const Route = createFileRoute('/balance')({
  // Tracks the page <h1>, not the shorter nav label; the divergence is deliberate.
  head: () => ({
    meta: [
      { title: 'Balance Tracking · Longhand Budget' },
      {
        name: 'description',
        content:
          'Monitor your investments, debts and what you own outright, and see your net worth including savings.',
      },
    ],
  }),
  component: BalancePage,
})
