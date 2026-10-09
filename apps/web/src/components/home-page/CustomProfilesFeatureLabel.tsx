import type React from 'react'

export function CustomProfilesFeatureLabel(): React.ReactElement {
	return (
		<span className="flex flex-col">
			<span className="font-medium text-subheading">Custom Profiles</span>
			<span className="text-sm text-muted">
				Keep separate finances — e.g. personal vs. household — and switch without mixing the numbers
			</span>
		</span>
	)
}
