import { useState } from 'react'
import { useSessionSeed } from '../../context/session-seed'
import { isEntitledSeed } from '../../lib/premium/entitlement'
import { useVerifiedSession } from '../../lib/session/verifiedSession'
import { AccountSection } from './account-section'
import { CategoriesSection } from './categories-section'
import { CurrencyToggle } from './currency-toggle'
import { LocalDataSection } from './local-data-section'
import { ReportSection } from './report-section'
import { RetirementVisibilityToggle } from './retirement-visibility-toggle'

export function SettingsPage() {
	// Fails open, unlike GlobalNav: these tiles may be a paid user's only route to
	// the report and categories pages if the seed is wrong.
	const sessionSeed = useSessionSeed()
	const [seedReachesPremium] = useState(() => isEntitledSeed(sessionSeed))
	const verifiedSession = useVerifiedSession()
	const reachesPremiumFromNav =
		verifiedSession === undefined ? seedReachesPremium : isEntitledSeed(verifiedSession)

	return (
		<main className="mx-auto max-w-xl px-4 py-10">
			<h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
			<p className="mt-2 text-gray-600 dark:text-gray-400">
				These preferences apply across the whole app.
			</p>

			<section
				aria-labelledby="settings-display-heading"
				className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
			>
				<h2
					id="settings-display-heading"
					className="text-lg font-semibold text-gray-900 dark:text-gray-100"
				>
					Display
				</h2>
				<div className="mt-4 space-y-6">
					<div>
						<CurrencyToggle />
						<p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
							Applies everywhere amounts are shown.
						</p>
					</div>
					<div>
						{/* aria-describedby, not mere proximity: the description carries the data-safety reassurance. */}
						<RetirementVisibilityToggle describedBy="settings-retirement-visibility-description" />
						<p
							id="settings-retirement-visibility-description"
							className="mt-2 text-sm text-gray-500 dark:text-gray-400"
						>
							Turn this off to remove the Retirement planner from your navigation, along with the
							retirement question on the expense form. Your income, expenses and balances are
							unaffected, and any expenses you marked are kept for when you turn it back on.
						</p>
					</div>
				</div>
			</section>

			<LocalDataSection />

			{/* Don't move this privacy sentence onto /financial-summary: the report omits it deliberately and a test pins its absence. */}
			{!reachesPremiumFromNav && <ReportSection />}

			{!reachesPremiumFromNav && <CategoriesSection />}

			<AccountSection />
		</main>
	)
}
