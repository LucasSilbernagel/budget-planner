import { createFileRoute } from '@tanstack/react-router'
import { BalancePage } from '../components/BalancePage'

export const Route = createFileRoute('/balance')({
  // "Balance Tracking", not "Balance": the nav label and the page's own <h1> were
  // both renamed by UX-DR48 (epic 43), and the tab title follows them.
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
