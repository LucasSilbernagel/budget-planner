import type React from 'react'

export function ReportFeatureLabel(): React.ReactElement {
	return (
		<span className="text-sm font-medium text-heading">
			Financial summary report
			<span className="mt-1 block text-sm font-normal text-muted">
				A printable summary of your budget, net worth and savings
			</span>
		</span>
	)
}
