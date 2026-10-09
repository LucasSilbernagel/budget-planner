import type React from 'react'

export function PageFooter(): React.ReactElement {
	return (
		<footer className="mt-8 pt-6 border-t border-default text-center">
			<p className="text-xs text-faint">
				Forecasts calculated in your browser • Saved forecasts stored in Germany (EU)
			</p>
		</footer>
	)
}
