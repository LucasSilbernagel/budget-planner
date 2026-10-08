import { SettingsPage } from '@/components/settings/settings-page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  head: () => ({
    meta: [
      { title: 'Settings · Longhand Budget' },
      {
        name: 'description',
        content: 'Currency, appearance and other preferences that apply across the whole app.',
      },
    ],
  }),
  component: SettingsPage,
})
