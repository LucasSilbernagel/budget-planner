import { SettingsPage } from '@/components/settings/settings-page'
import { createFileRoute } from '@tanstack/react-router'

/**
 * Consolidated settings surface — `/settings` (story 11-6).
 *
 * Thin route wrapper: the page lives in `components/settings/settings-page.tsx`
 * so this module exports only `Route` and stays code-splittable.
 */
export const Route = createFileRoute('/settings')({
  head: () => ({ meta: [{ title: 'Settings · SoluBudget' }] }),
  component: SettingsPage,
})
