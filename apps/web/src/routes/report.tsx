import { ReportPage } from '@/components/reports/ReportPage'
import { createFileRoute } from '@tanstack/react-router'

/**
 * Premium financial summary report — `/report` (story 30-3, FR53).
 *
 * Thin route wrapper: the page lives in `components/reports/ReportPage.tsx` so
 * this module exports only `Route` and stays code-splittable.
 *
 * Deliberately absent from `GlobalNav`: the nav is already tight at 320px, and
 * `/settings` carries the (gated) entry point, so this is reachable without
 * being a nav orphan.
 */
export const Route = createFileRoute('/report')({
  head: () => ({ meta: [{ title: 'Financial summary · Longhand Budget' }] }),
  component: ReportPage,
})
