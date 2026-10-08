// `Route` must stay the only export: any other export silently defeats the
// router's code splitting.

import { createFileRoute } from '@tanstack/react-router'
import { ProfilesPage } from '@/components/profiles/profiles-page'

export const Route = createFileRoute('/profiles')({
	head: () => ({
		meta: [
			{ title: 'Profiles · Longhand Budget' },
			{ name: 'description', content: 'Organize your finances with multiple profiles.' },
		],
	}),
	component: ProfilesPage,
})
