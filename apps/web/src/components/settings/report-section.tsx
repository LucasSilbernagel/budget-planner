import type React from 'react'
import { PremiumFeatureGate } from '../premium/PremiumFeatureGate'

function ReportFeatureLabel(): React.ReactElement {
	return (
		<span className="text-sm font-medium text-heading">
			Financial summary report
			<span className="mt-1 block text-sm font-normal text-muted">
				A printable summary of your budget, net worth and savings
			</span>
		</span>
	)
}

export function ReportSection(): React.ReactElement {
	return (
		<section
			aria-labelledby="settings-report-heading"
			className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
		>
			<h2
				id="settings-report-heading"
				className="text-lg font-semibold text-gray-900 dark:text-gray-100"
			>
				Financial Summary
			</h2>
			<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
				Build a print-ready summary of the figures stored on this device and save it as a PDF
				through your browser's print dialog. The summary is assembled in your browser — nothing is
				sent anywhere to produce it.
			</p>
			{/* Own wrapper: the locked gate renders a portal-less Modal sibling that would otherwise pick up the stack's gap. */}
			<div className="mt-3">
				<PremiumFeatureGate
					featureName="Financial Summary Report"
					className="border-default surface-interactive flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
					locked={<ReportFeatureLabel />}
				>
					<a
						href="/financial-summary"
						className="border-default surface-interactive flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
					>
						<ReportFeatureLabel />
						<span className="whitespace-nowrap text-sm font-medium text-accent">Open →</span>
					</a>
				</PremiumFeatureGate>
			</div>
		</section>
	)
}
