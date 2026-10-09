import type React from 'react'

export function LoadingSpinner(): React.ReactElement {
	return (
		<div className="flex items-center justify-center space-x-2">
			<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			<span className="text-body">Loading...</span>
		</div>
	)
}
