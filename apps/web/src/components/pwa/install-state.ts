const DISMISSAL_STORAGE_KEY = 'bp-pwa-install-dismissed'

const DISMISSAL_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

// navigator.standalone is iOS Safari's non-standard flag.
export function isRunningStandalone(): boolean {
	if (typeof window === 'undefined') {
		return false
	}
	try {
		if (
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(display-mode: standalone)').matches
		) {
			return true
		}
	} catch {
		// Ignore matchMedia failures; fall through to the iOS check.
	}
	return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

// Storage failures (Safari private mode) and corrupt values count as not dismissed.
export function wasRecentlyDismissed(): boolean {
	try {
		const raw = localStorage.getItem(DISMISSAL_STORAGE_KEY)
		if (!raw) {
			return false
		}
		const dismissedAt = Number.parseInt(raw, 10)
		// Reject future timestamps too: a negative delta would suppress the affordance forever.
		if (!Number.isFinite(dismissedAt) || dismissedAt > Date.now()) {
			return false
		}
		return Date.now() - dismissedAt < DISMISSAL_INTERVAL_MS
	} catch {
		return false
	}
}

export function rememberDismissal(): void {
	try {
		localStorage.setItem(DISMISSAL_STORAGE_KEY, Date.now().toString())
	} catch {
		// Blocked/full storage: the dismissal simply will not persist across visits.
	}
}
