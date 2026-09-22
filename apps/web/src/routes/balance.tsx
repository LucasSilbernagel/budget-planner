import { createFileRoute } from '@tanstack/react-router'
import { BalancePage } from '../components/BalancePage'

export const Route = createFileRoute('/balance')({
  // "Balance Tracking", not "Balance": the tab title tracks the page's own <h1>
  // (`BalancePage.tsx`), which UX-DR48 (epic 43) renamed and which is unchanged.
  // ⚠️ It no longer tracks the NAV label. Story 59.1 (FR89) shortened that to
  // "Balances" on purpose — a nav label names the destination as briefly as it
  // can, a tab title names the page. The divergence is deliberate; do not
  // "resync" this string to the nav.
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
