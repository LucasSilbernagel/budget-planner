import { useEffect, useRef, useState } from 'react'
import { planLabel } from '@/lib/account/plan-label'
import { purgeLocalFinancialData } from '@/lib/account/purge-local-financial-data'
import { returnToSignedOutHome, signOut } from '@/lib/account/sign-out'
import { hasPaidAccess } from '@/lib/premium/access-statuses'
import { purgeAppShellCache } from '@/lib/pwa/app-shell-cache'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { type CurrentUser, fetchCurrentUser } from './fetch-current-user'

type AuthState =
	| { status: 'loading' }
	| { status: 'unauthenticated' }
	| { status: 'authenticated'; user: CurrentUser }

export function AccountSection() {
	const [authState, setAuthState] = useState<AuthState>({ status: 'loading' })
	const [isConfirmOpen, setIsConfirmOpen] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const sectionRef = useRef<HTMLElement | null>(null)

	useEffect(() => {
		let active = true
		fetchCurrentUser()
			.then((user) => {
				if (!active) {
					return
				}
				setAuthState(user ? { status: 'authenticated', user } : { status: 'unauthenticated' })
			})
			.catch(() => {
				if (active) {
					setAuthState({ status: 'unauthenticated' })
				}
			})
		return () => {
			active = false
		}
	}, [])

	const [isSigningOut, setIsSigningOut] = useState(false)
	const handleSignOut = async (): Promise<void> => {
		// No re-entry guard: `disabled` blocks a second click and `signOut()` dedupes at module level.
		setIsSigningOut(true)
		try {
			await signOut()
		} finally {
			// Reset so a sign-out that timed out rather than navigating leaves the button usable.
			setIsSigningOut(false)
		}
	}

	const handleConfirmDelete = async (): Promise<void> => {
		if (authState.status !== 'authenticated') {
			return
		}
		const { userId } = authState.user

		setIsDeleting(true)
		setError(null)

		try {
			const response = await fetch('/api/account/delete', { method: 'POST' })
			if (!response.ok) {
				throw new Error(`Delete failed with status ${response.status}`)
			}
		} catch {
			setError('We could not delete your account. Please try again.')
			setIsConfirmOpen(false)
			setIsDeleting(false)
			return
		}

		// Past here the account is irreversibly deleted; local cleanup and sign-out are
		// best-effort and must never surface as a deletion failure.
		await purgeLocalFinancialData(userId)
		// The service worker's cached pages carry the deleted account's email.
		await purgeAppShellCache()
		setIsConfirmOpen(false)
		try {
			returnToSignedOutHome()
		} catch (error) {
			console.error('Account deleted, but sign-out redirect failed', error)
		}
	}

	if (authState.status !== 'authenticated') {
		return null
	}

	// Deletion cancels the subscription immediately, forfeiting paid time. Deliberate:
	// a subscription outliving the user row could resurrect the account via webhook.
	const billingForfeitureNotice = hasPaidAccess(authState.user.subscriptionStatus)
		? ' Your Premium subscription is cancelled immediately — any remaining paid time is forfeited and will not be refunded.'
		: ''

	return (
		<section
			ref={sectionRef}
			aria-labelledby="settings-account-heading"
			className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
		>
			<h2
				id="settings-account-heading"
				className="text-lg font-semibold text-gray-900 dark:text-gray-100"
			>
				Account
			</h2>

			<div className="mt-4 space-y-6">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex flex-col">
						<span className="text-sm font-medium text-gray-900 dark:text-gray-100">
							{authState.user.email}
						</span>
						<span className="text-xs text-gray-500 dark:text-gray-400">
							{planLabel(authState.user.subscriptionStatus, authState.user.billingInterval)}
						</span>
					</div>
					<button
						type="button"
						onClick={handleSignOut}
						disabled={isSigningOut}
						className="rounded-md border border-gray-500 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
					>
						Sign out
					</button>
				</div>

				<div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
					<h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Delete account</h3>
					<p className="mt-1 text-sm text-red-700 dark:text-red-300/80">
						Permanently deletes your account and all synced financial data. This cannot be undone.
						{billingForfeitureNotice}
					</p>
					<button
						type="button"
						onClick={() => {
							setError(null)
							setIsConfirmOpen(true)
						}}
						className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
					>
						Delete account
					</button>
					{error && (
						<p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
							{error}
						</p>
					)}
				</div>
			</div>

			<ConfirmDialog
				isOpen={isConfirmOpen}
				onConfirm={handleConfirmDelete}
				onCancel={() => setIsConfirmOpen(false)}
				title="Delete your account?"
				confirmLabel={isDeleting ? 'Deleting…' : 'Delete account'}
				isConfirming={isDeleting}
				finalFocusRef={sectionRef}
				message={`This permanently deletes your account and all synced data (income, expenses, savings goals, balances, and profiles). This cannot be undone.${billingForfeitureNotice}`}
			/>
		</section>
	)
}
