import { ReportPage } from '@/components/reports/ReportPage'
import { createFileRoute } from '@tanstack/react-router'

/**
 * Premium Financial Summary — `/financial-summary` (story 30-3, FR53; renamed
 * from the old report path by story 95.2, FR155 — no redirect, the old path is
 * a plain 404, D2).
 *
 * Thin route wrapper: the page lives in `components/reports/ReportPage.tsx` so
 * this module exports only `Route` and stays code-splittable.
 *
 * Entry points: entitled sessions reach it from the paid More panel in
 * `GlobalNav` (story 58.1); free sessions see the gated Settings tile and the
 * Overview benefit box instead (58.2).
 */
export const Route = createFileRoute('/financial-summary')({
  head: () => ({
    meta: [
      { title: 'Financial Summary · Longhand Budget' },
      {
        name: 'description',
        content: 'A printable summary of your income, expenses, savings and net worth.',
      },
    ],
  }),
  component: ReportPage,
})
