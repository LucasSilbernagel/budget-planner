import type React from 'react'

export function PageHeader(): React.ReactElement {
	return (
		<header className="surface border-b border-default sticky top-0 z-10">
			<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
				<div className="flex items-center justify-between">
					{/* No subtitle and no Premium badge, deliberately: the header is sticky and the intro
              does the explaining. */}
					<div>
						<h1 className="text-2xl font-bold text-subheading">Financial Forecasting</h1>
					</div>
				</div>
			</div>
		</header>
	)
}
