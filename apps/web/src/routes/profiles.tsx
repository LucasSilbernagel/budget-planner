// `Route` must stay the only export: any other export silently defeats the
// router's code splitting.

import { ProfilesPage } from '@/components/profiles/profiles-page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/profiles')({
  head: () => ({
    meta: [
      { title: 'Profiles · Longhand Budget' },
      { name: 'description', content: 'Organize your finances with multiple profiles.' },
    ],
  }),
  component: ProfilesPage,
})
