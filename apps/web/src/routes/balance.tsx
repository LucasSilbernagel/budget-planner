import { createFileRoute } from '@tanstack/react-router'
import { BalancePage } from '../components/BalancePage'

export const Route = createFileRoute('/balance')({
  component: BalancePage,
})
