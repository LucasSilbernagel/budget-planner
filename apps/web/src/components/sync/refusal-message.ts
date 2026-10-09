import type { RefusalNotice } from '@/lib/sync/refusalNoticeStore'

export function subject(notice: RefusalNotice): string {
	if (notice.name !== null) {
		return `“${notice.name}” (${notice.kind})`
	}
	return notice.fallback.charAt(0).toLowerCase() + notice.fallback.slice(1)
}

const NOT_SAVED = "couldn't be saved to your account"

const NOT_SYNCED_YET = "hasn't reached your account yet."
const SAVED_SENT_NEXT_SYNC = "It's saved on this device and will be sent the next time it syncs."
const DELETE_SENT_NEXT_SYNC = 'It will be sent the next time this device syncs.'

export function noticeHeading(notice: RefusalNotice): string {
	return notice.outcome === 'not-synced' ? 'Not synced yet' : 'Not saved to your account'
}

export function refusalMessage(notice: RefusalNotice): string {
	const what = subject(notice)
	// A refused retirement plan edit is not reverted, so neither "removed" nor
	// "changed back" would be true.
	if (notice.entityType === 'retirementPlan' && notice.outcome !== 'not-synced') {
		return `${capitalise(what)} ${NOT_SAVED}. It is still saved on this device.`
	}
	switch (notice.outcome) {
		case 'removed':
			return notice.entityType === 'userProfile'
				? `${capitalise(
						what
					)} ${NOT_SAVED}, so it was removed from this device, together with the entries in it.`
				: `${capitalise(what)} ${NOT_SAVED}, so it was removed from this device.`
		case 'restored':
			return `Deleting ${what} ${NOT_SAVED}, so it is being restored from your account.`
		case 'changed-back':
			return `Your change to ${what} ${NOT_SAVED}, so it is being changed back to what your account has.`
		case 'not-synced':
			if (notice.change === 'create') {
				return `${capitalise(what)} ${NOT_SYNCED_YET} ${SAVED_SENT_NEXT_SYNC}`
			}
			if (notice.change === 'delete') {
				return `Deleting ${what} ${NOT_SYNCED_YET} ${DELETE_SENT_NEXT_SYNC}`
			}
			return `Your change to ${what} ${NOT_SYNCED_YET} ${SAVED_SENT_NEXT_SYNC}`
		default: {
			// Fallback for an outcome the types didn't foresee: say only what is certainly true.
			const unhandled: never = notice.outcome
			console.error('[RefusedEditNotice] unknown notice outcome:', unhandled)
			return `${capitalise(what)} ${NOT_SYNCED_YET}`
		}
	}
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1)
}
