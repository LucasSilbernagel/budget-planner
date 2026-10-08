// Fail-closed: only a resolved, entitled tier reaches the report. There is no server side to
// enforce; the report is built from data already in the browser.

import type React from 'react'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { PremiumPrompt } from '../auth/premium-prompt'
import { FinancialSummaryReport } from './FinancialSummaryReport'

export function ReportPage(): React.ReactElement {
	const { status } = usePremiumAccess()

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

	if (!status.hasAccess) {
		return (
			<main
				key="premium-locked"
				className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900"
			>
				<PremiumPrompt
					featureName="Financial Summary Report"
					message="Produce a printable summary of your budget, net worth and savings, built entirely in your browser and saved as a PDF through your own print dialog."
					asDialog={false}
				/>
			</main>
		)
	}

	return <FinancialSummaryReport key="premium-content" />
}
