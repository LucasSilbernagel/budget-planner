import { ReportPage } from '@/components/reports/ReportPage'
import { createFileRoute } from '@tanstack/react-router'

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
