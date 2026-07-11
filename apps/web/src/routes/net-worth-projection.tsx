import { createFileRoute } from '@tanstack/react-router'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { NetWorthProjectionPage } from '../components/NetWorthProjectionPage'

export const Route = createFileRoute('/net-worth-projection')({
  // Mirror the /retirement route precedent: contain any residual throw from the
  // compounding calc (e.g. an overflowing derived principal from stored balances)
  // in the themed fallback instead of white-screening the whole route.
  component: () => (
    <ErrorBoundary>
      <NetWorthProjectionPage />
    </ErrorBoundary>
  ),
})
