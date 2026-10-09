import type React from 'react'

// Categories apply to income and expenses only and do not sync; the subtitle must still name the breakdown.
export function CategoriesFeatureLabel(): React.ReactElement {
	return (
		<span className="flex flex-col">
			<span className="font-medium text-subheading">Custom categories</span>
			<span className="text-sm text-muted">
				Group your income and expenses your way, and see what each category totals
			</span>
		</span>
	)
}
