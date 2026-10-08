import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/components/settings/settings-page'

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
