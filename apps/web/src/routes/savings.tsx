import { createFileRoute } from '@tanstack/react-router'
import { SavingsPage } from '../components/SavingsPage'

export const Route = createFileRoute('/savings')({
  component: SavingsPage,
})
