import type React from 'react'

// Every situation the subtitle names must be expressible by the engine: recurring items have no start or end year,
// so no house purchase or early retirement. The subtitle is part of the accessible name; check role-query regexes.
export function PremiumFeatureLabel(): React.ReactElement {
	return (
		<span className="flex flex-col">
			<span className="font-medium text-subheading">Advanced Forecasting</span>
			<span className="text-sm text-muted">
				See how a raise, rising bills, a big one-off cost, paying down a loan or saving more each
				month plays out over the years ahead
			</span>
		</span>
	)
}
