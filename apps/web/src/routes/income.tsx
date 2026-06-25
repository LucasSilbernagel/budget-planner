import { createFileRoute } from '@tanstack/react-router'
import { IncomePage } from '../components/IncomePage'

export const Route = createFileRoute('/income')({
  component: IncomePage,
})
