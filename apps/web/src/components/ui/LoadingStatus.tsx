import type React from 'react'

/**
 * One per page, never one per skeleton. The message is text content, not an `aria-label`:
 * an empty live region announces nothing.
 */
export function LoadingStatus(): React.ReactElement {
	return (
		<div role="status" data-testid="page-loading-status" className="sr-only">
			Loading your figures
		</div>
	)
}
