import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from '../components/HomePage'

export const Route = createFileRoute('/')({
  // Per-route metadata (story 40.1, FR65). The nav calls this page "Overview";
  // the page's own <h1> is the brand wordmark, so the nav label is the name that
  // distinguishes this tab from the others. Story 95.1 (FR154) dropped the
  // "income, expenses & net worth" filler: the title is just the page name.
  head: () => ({
    meta: [
      { title: 'Overview · Longhand Budget' },
      {
        name: 'description',
        content:
          'Your income, expenses, savings and net worth at a glance, with category breakdowns for any period.',
      },
    ],
  }),
  component: HomePage,
})
