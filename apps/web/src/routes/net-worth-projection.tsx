import { createFileRoute } from '@tanstack/react-router'
import { NetWorthProjectionPage } from '../components/NetWorthProjectionPage'

export const Route = createFileRoute('/net-worth-projection')({
  component: NetWorthProjectionPage,
})
