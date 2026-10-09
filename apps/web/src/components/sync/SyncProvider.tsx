import { type ReactElement, Suspense, useEffect, useState } from 'react'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { hasPaidAccess } from '@/lib/premium/access-statuses'
import { accountBoundaryAppliedFor, applyAccountBoundary } from '@/lib/sync/accountBoundary'
import { setSyncSessionStatus } from '@/lib/sync/sessionStatusStore'
import { ErrorBoundary } from '../ErrorBoundary'

const ActiveSync = lazyWithRetry(() =>
	import('./ActiveSync').then((m) => ({ default: m.ActiveSync }))
)

type SessionUser = {
	userId: string
	subscriptionStatus: string
}

function isPaidSyncSession(user: SessionUser | null): user is SessionUser {
	return user !== null && hasPaidAccess(user.subscriptionStatus)
}

// `has_session` is a non-HttpOnly presence marker: the real session cookie is never
// visible to document.cookie. It is not trusted; /api/auth/me decides.
export function hasProbableSession(cookieString: string): boolean {
	return /(?:^|;\s*)has_session=/.test(cookieString)
}

export function SyncProvider(): ReactElement | null {
	const [user, setUser] = useState<SessionUser | null>(null)
	const [resolved, setResolved] = useState(false)

	useEffect(() => {
		let cancelled = false
		// document.cookie can throw SecurityError in sandboxed iframes, and nothing above
		// this effect would catch it.
		let cookieString = ''
		try {
			cookieString = typeof document !== 'undefined' ? document.cookie : ''
		} catch {
			cookieString = ''
		}
		// No session cookie: skip the probe so anonymous visitors make zero network calls.
		if (!hasProbableSession(cookieString)) {
			applyAccountBoundary('')
			setResolved(true)
			setSyncSessionStatus(true, false)
			return
		}
		let definitive = false
		fetch('/api/auth/me', { headers: { Accept: 'application/json' } })
			.then((response) => {
				// Only a 200 is definitive; a 503 is the resolver failing.
				definitive = response.ok
				return response.ok ? response.json() : { user: null }
			})
			.then((body: { user?: SessionUser | null }) => {
				if (!cancelled) {
					// Apply the boundary for the verified session before ActiveSync renders; never on
					// an unverified answer, so an offline paid user keeps their data.
					const verified = body.user?.userId ?? ''
					if (definitive && accountBoundaryAppliedFor() !== verified) {
						applyAccountBoundary(verified)
					}
					setUser(body.user ?? null)
					setResolved(true)
					setSyncSessionStatus(true, isPaidSyncSession(body.user ?? null))
				}
			})
			.catch(() => {
				if (!cancelled) {
					setUser(null)
					setResolved(true)
					setSyncSessionStatus(true, false)
				}
			})
		return () => {
			cancelled = true
		}
	}, [])

	if (!resolved || !isPaidSyncSession(user)) {
		return null
	}

	// Load-bearing: a failed chunk import must degrade to no sync rather than reach the
	// router's root catch and replace the whole app.
	return (
		<ErrorBoundary
			fallback={null}
			onError={(error) => {
				console.error('[SyncProvider] sync engine failed to load; continuing without sync:', error)
			}}
		>
			<Suspense fallback={null}>
				<ActiveSync userId={user.userId} />
			</Suspense>
		</ErrorBoundary>
	)
}
