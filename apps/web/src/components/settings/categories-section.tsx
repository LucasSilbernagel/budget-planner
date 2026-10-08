import type React from 'react'
import { PremiumFeatureGate } from '../premium'

function CategoriesFeatureLabel(): React.ReactElement {
	return (
		<span className="text-sm font-medium text-heading">
			Custom categories
			<span className="mt-1 block text-sm font-normal text-muted">
				Your own income and expense groupings
			</span>
		</span>
	)
}

export function CategoriesSection(): React.ReactElement {
	return (
		<section
			aria-labelledby="settings-categories-heading"
			className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
		>
			<h2
				id="settings-categories-heading"
				className="text-lg font-semibold text-gray-900 dark:text-gray-100"
			>
				Categories
			</h2>
			<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
				Create the categories you want to sort your income and expenses into, then pick one when you
				add or edit an entry. Renaming a category updates every entry that uses it.
			</p>
			{/* Own wrapper: the locked gate renders a portal-less Modal sibling that would otherwise pick up the stack's gap. */}
			<div className="mt-3">
				<PremiumFeatureGate
					featureName="Custom Categories"
					className="border-default surface-interactive flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
					locked={<CategoriesFeatureLabel />}
				>
					<a
						href="/categories"
						className="border-default surface-interactive flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
					>
						<CategoriesFeatureLabel />
						<span className="whitespace-nowrap text-sm font-medium text-accent">Open →</span>
					</a>
				</PremiumFeatureGate>
			</div>
		</section>
	)
}
