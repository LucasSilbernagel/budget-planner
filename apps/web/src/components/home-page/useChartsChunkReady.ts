import React from 'react'

let chartChunkResolved = false

// Drives aria-busy only: a role="status" region per chart would compete with the page's single announcer.
export function useChartsChunkReady(): boolean {
	const [ready, setReady] = React.useState(chartChunkResolved)

	React.useEffect(() => {
		if (chartChunkResolved) {
			return
		}
		let active = true
		void import('../HomeChartCanvases')
			.then(() => {
				chartChunkResolved = true
				if (active) {
					setReady(true)
				}
			})
			.catch(() => {
				// The ErrorBoundary around each canvas owns the failure; this only drives an aria attribute.
			})
		return () => {
			active = false
		}
	}, [])

	return ready
}
