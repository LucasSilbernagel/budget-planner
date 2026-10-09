import type React from 'react'

export function MultiDeviceSyncLabel(): React.ReactElement {
	return (
		<span className="flex flex-col">
			<span className="font-medium text-subheading">Multi-device sync</span>
			<span className="text-sm text-muted">
				Your data securely stored and synced across all your devices
			</span>
		</span>
	)
}
