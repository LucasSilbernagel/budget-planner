// Lives outside the route file so the router's code splitter can split it; as the route's
// only split-eligible export it silently kept the route in the eager bundle.

import { useState } from 'react'
import { PremiumPrompt } from '@/components/auth/premium-prompt'
import { CreateProfileDialog } from '@/components/profiles/create-profile'
import { ProfileList } from '@/components/profiles/profile-list'
import { usePremiumAccess } from '@/hooks/usePremiumAccess'

export function ProfilesPage() {
	const { status } = usePremiumAccess()
	const [showCreateDialog, setShowCreateDialog] = useState(false)

	// Tier unknown (SSR + first paint): neutral and hydration-safe; never leaks the UI (fail-closed).
	if (status.isLoading) {
		// Each branch's outer element has its own key so React replaces the loading subtree
		// rather than growing the spinner's div (a layout shift). Do not remove.
		return (
			<main
				key="premium-loading"
				className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900"
			>
				<div
					role="status"
					aria-label="Loading"
					className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
				/>
			</main>
		)
	}

	// The server functions enforce the same boundary independently.
	if (!status.hasAccess) {
		return (
			<main
				key="premium-locked"
				className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900"
			>
				<PremiumPrompt
					featureName="Custom Profiles"
					message="Keep separate sets of finances (e.g. personal vs. household) in custom profiles and switch between them, synced across your devices."
					asDialog={false}
				/>
			</main>
		)
	}

	return (
		<main key="premium-content" className="min-h-screen bg-gray-50 p-4 md:p-8 dark:bg-gray-900">
			<div className="max-w-4xl mx-auto">
				<div className="flex items-center justify-between mb-8">
					<div>
						<h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Profiles</h1>
						<p className="text-gray-600 mt-1 dark:text-gray-400">
							Organize your finances with multiple profiles
						</p>
					</div>

					<div className="flex items-center gap-4">
						<button
							type="button"
							onClick={() => setShowCreateDialog(true)}
							className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
						>
							+ New Profile
						</button>
					</div>
				</div>

				<div className="bg-white rounded-xl shadow-md p-6 dark:bg-gray-800">
					<ProfileList onCreateNewProfile={() => setShowCreateDialog(true)} />
				</div>

				{showCreateDialog && <CreateProfileDialog onClose={() => setShowCreateDialog(false)} />}

				<div className="mt-8 bg-blue-50 rounded-xl p-6 dark:bg-blue-950/40">
					<h2 className="text-lg font-semibold text-blue-800 mb-2 dark:text-blue-200">
						About Profiles
					</h2>
					<p className="text-blue-700 dark:text-blue-300">
						Profiles help you organize your financial data for different purposes. Each profile has
						its own set of income, expenses, savings goals, and balance tracking. Switch between
						profiles to view different financial scenarios.
					</p>
					<p className="text-blue-700 mt-2 dark:text-blue-300">
						Your profiles are synchronized across all your devices via DanubeData (Germany - EU).
					</p>
				</div>
			</div>
		</main>
	)
}
