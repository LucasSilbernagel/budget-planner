import { Link } from '@tanstack/react-router'
import type React from 'react'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../lib/premium/benefits'
import { CheckIcon } from '../icons/CheckIcon'
import { CloseIcon } from '../icons/CloseIcon'
import { CrownIcon } from '../icons/CrownIcon'
import { SparklesIcon } from '../icons/SparklesIcon'
import { CardHeader } from '../ui/CardHeader'

/**
 * Terse names: the list must fit a 320×480 dialog. "Downloadable" on the report is a
 * decided exception to one-name-per-feature, for this card only; don't spread or revert it.
 */
export const PREMIUM_FEATURES: Record<PremiumBenefitId, string> = {
	sync: 'Multi-Device Data Sync',
	forecasting: 'Advanced Forecasting — Raises, Rising Bills & One-Off Costs',
	profiles: 'Custom User Profiles',
	report: 'Downloadable Financial Summary Report',
	categories: 'Custom Categories & Category Breakdown',
}

type PremiumPromptContentProps = {
	featureName?: string
	message: string
	upgradeHref: string
	onUpgradeClick: (e: React.MouseEvent) => void
	onClose: (e: React.MouseEvent) => void
}

export function PremiumPromptContent({
	featureName,
	message,
	upgradeHref,
	onUpgradeClick,
	onClose,
}: PremiumPromptContentProps): React.ReactElement {
	return (
		<div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-800 rounded-xl shadow-lg border border-blue-200 dark:border-gray-700 p-6 max-w-md mx-auto w-full">
			<CardHeader className="mb-4">
				<div className="flex items-center">
					<div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
						<CrownIcon className="w-6 h-6 text-white" />
					</div>
					<h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Go Premium</h2>
				</div>
				{onClose && (
					<button
						type="button"
						onClick={onClose}
						className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
						aria-label="Close"
					>
						<CloseIcon className="w-5 h-5" />
					</button>
				)}
			</CardHeader>

			<div className="mb-4">
				{featureName && (
					<p className="text-gray-700 dark:text-gray-300 mb-2">
						You need a premium subscription to access
						<span className="font-semibold text-blue-600 dark:text-blue-400 ml-1">
							"{featureName}"
						</span>
						.
					</p>
				)}
				{/* Own testid so a caller's message is asserted on its own element, not the benefit list. */}
				<p
					data-testid="premium-prompt-message"
					className="text-gray-600 dark:text-gray-400 text-sm"
				>
					{message}
				</p>
			</div>

			<div className="mb-6">
				<h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
					What you get:
				</h3>
				<ul className="space-y-2">
					{PREMIUM_BENEFIT_IDS.map((id) => PREMIUM_FEATURES[id]).map((feature) => (
						<li
							key={feature}
							className="flex items-center text-sm text-gray-600 dark:text-gray-400"
						>
							<CheckIcon className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
							{feature}
						</li>
					))}
				</ul>
			</div>

			<div className="flex flex-col sm:flex-row gap-2">
				<Link
					to={upgradeHref}
					className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg shadow hover:bg-blue-700 transition-colors text-center"
					onClick={onUpgradeClick}
				>
					<SparklesIcon className="w-4 h-4 mr-2" />
					Upgrade to Premium
				</Link>
				<button
					type="button"
					onClick={onClose || (() => {})}
					className="inline-flex items-center justify-center px-4 py-2 bg-white text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600 transition-colors text-center"
					disabled={!onClose}
				>
					Maybe Later
				</button>
			</div>

			<p className="mt-4 text-xs text-center text-gray-400">All data stored in Germany (EU)</p>
		</div>
	)
}
