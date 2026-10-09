import { type ReactElement, useEffect, useState } from 'react'
import { dropAnotherAccountsLocalData } from '@/lib/sync/dropAnotherAccountsLocalData'
import { ActiveSyncEngine } from './ActiveSyncEngine'

// Removes another account's data from the shared stores before the engine mounts,
// so its first render never reads them.
export function ActiveSync({ userId }: { userId: string }): ReactElement | null {
	const [clearedFor, setClearedFor] = useState<string | null>(null)
	useEffect(() => {
		dropAnotherAccountsLocalData(userId)
		setClearedFor(userId)
	}, [userId])
	if (clearedFor !== userId) {
		return null
	}
	return <ActiveSyncEngine userId={userId} />
}
