import type React from 'react'

export function CategoriesFeatureLabel(): React.ReactElement {
	return (
		<span className="text-sm font-medium text-heading">
			Custom categories
			<span className="mt-1 block text-sm font-normal text-muted">
				Your own income and expense groupings
			</span>
		</span>
	)
}
