import { useEffect, useState } from 'react'

// A `null` seed means unverified, not signed out: ask `/api/auth/me` rather than guess.
export function useResolvedStatusWhenUnverified(seedIsNull: boolean) {
	const [status, setStatus] = useState<string | null | undefined>(seedIsNull ? undefined : null)

	useEffect(() => {
		if (!seedIsNull) return
		let cancelled = false
		void (async () => {
			try {
				const res = await fetch('/api/auth/me')
				const body = (await res.json()) as { user?: { subscriptionStatus?: string } | null }
				if (!cancelled) setStatus(body?.user?.subscriptionStatus ?? null)
			} catch {
				// Fail open: the checkout-config endpoint refuses an entitled session regardless.
				if (!cancelled) setStatus(null)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [seedIsNull])

	return status
}
