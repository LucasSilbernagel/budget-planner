import type { ReactElement } from 'react'
import {
	dismissAllRefusalNotices,
	dismissRefusalNotice,
	useRefusalNotices,
} from '@/lib/sync/refusalNoticeStore'
import { noticeHeading, refusalMessage, subject } from './refusal-message'

// role="alert" announces on insertion, so each notice is its own node. z-[60] keeps
// it above the Modal backdrop so it stays dismissable.
export function RefusedEditNotice({
	onRetry,
	isRetrying = false,
}: {
	onRetry?: () => void
	isRetrying?: boolean
} = {}): ReactElement | null {
	const notices = useRefusalNotices()
	if (notices.length === 0) {
		return null
	}
	return (
		<div className="fixed top-4 left-1/2 z-[60] flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 overflow-y-auto">
			{notices.length > 1 ? (
				<button
					type="button"
					onClick={dismissAllRefusalNotices}
					className="self-end rounded-md bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
				>
					Dismiss all
				</button>
			) : null}
			{notices.map((notice) => (
				<div
					// The outcome is in the key: role="alert" announces on insertion, not on text change.
					key={`${notice.key}:${notice.outcome}`}
					role="alert"
					className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg dark:border-amber-700 dark:bg-gray-800"
				>
					<div className="min-w-0 flex-1">
						<p className="text-sm font-semibold text-gray-900 dark:text-white">
							{noticeHeading(notice)}
						</p>
						<p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
							{refusalMessage(notice)}
						</p>
						{notice.outcome === 'not-synced' && onRetry ? (
							<button
								type="button"
								onClick={onRetry}
								disabled={isRetrying}
								aria-label={`Try again to sync ${subject(notice)}`}
								className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-gray-800 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
							>
								Try again
							</button>
						) : null}
					</div>
					<button
						type="button"
						onClick={() => dismissRefusalNotice(notice.key)}
						aria-label={`Dismiss notice about ${subject(notice)}`}
						className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-gray-500 hover:bg-amber-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
					>
						<span aria-hidden="true" className="block h-4 w-4 text-center text-lg leading-4">
							&times;
						</span>
					</button>
				</div>
			))}
		</div>
	)
}
