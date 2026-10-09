import type React from 'react'

// The report covers budget, current net worth and savings only, and any PDF comes from the browser's print dialog:
// claim neither a retirement outlook nor a generated PDF.
export function ReportFeatureLabel(): React.ReactElement {
	return (
		<span className="flex flex-col">
			<span className="font-medium text-subheading">Financial summary report</span>
			<span className="text-sm text-muted">
				A print-ready summary of your budget, net worth and savings, built in your browser
			</span>
		</span>
	)
}
