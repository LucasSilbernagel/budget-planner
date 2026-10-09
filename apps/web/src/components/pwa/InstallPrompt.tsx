import { useCallback, useEffect, useRef, useState } from 'react'
import { isRunningStandalone, rememberDismissal, wasRecentlyDismissed } from './install-state'

// Chromium-only, and absent from the DOM lib types.
type BeforeInstallPromptEvent = Event & {
	readonly platforms: string[]
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
	prompt(): Promise<void>
}

// Renders nothing until beforeinstallprompt fires, so SSR and the first client render match.
export function InstallPrompt() {
	const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
	const affordanceRef = useRef<HTMLElement>(null)

	useEffect(() => {
		if (isRunningStandalone() || wasRecentlyDismissed()) {
			return
		}

		const onBeforeInstallPrompt = (event: Event) => {
			// Suppress Chromium's default mini-infobar; we drive our own affordance.
			event.preventDefault()
			// Re-check per event: a same-session re-fire after dismissal must not reappear.
			if (isRunningStandalone() || wasRecentlyDismissed()) {
				return
			}
			setPromptEvent(event as BeforeInstallPromptEvent)
		}
		const onAppInstalled = () => setPromptEvent(null)

		window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
		window.addEventListener('appinstalled', onAppInstalled)
		return () => {
			window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
			window.removeEventListener('appinstalled', onAppInstalled)
		}
	}, [])

	const dismiss = useCallback(() => {
		setPromptEvent(null)
		rememberDismissal()
	}, [])

	useEffect(() => {
		if (!promptEvent) {
			return
		}
		const onKeyDown = (event: KeyboardEvent) => {
			// Only when focus is within the affordance, so an Escape meant for other UI never dismisses it.
			if (event.key === 'Escape' && affordanceRef.current?.contains(document.activeElement)) {
				dismiss()
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [promptEvent, dismiss])

	const install = useCallback(async () => {
		const event = promptEvent
		if (!event) {
			return
		}
		// The captured event can only be prompted once.
		setPromptEvent(null)
		try {
			await event.prompt()
			const choice = await event.userChoice
			if (choice.outcome === 'dismissed') {
				rememberDismissal()
			}
		} catch {
			// A throwing prompt() (already consumed / detached) is non-fatal.
		}
	}, [promptEvent])

	if (!promptEvent) {
		return null
	}

	return (
		<section
			ref={affordanceRef}
			// Bottom offset mirrors the root layout's nav reserve (the rem+px split is deliberate). z-50 ties with
			// the nav, which renders later and so stays tappable. 'Longhand' must match the PWA short_name.
			aria-label="Install Longhand"
			className="fixed bottom-[calc(2.625rem_+_18px_+_env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-4 shadow-lg sm:bottom-4 dark:border-gray-700 dark:bg-gray-800"
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold text-gray-900 dark:text-white">Install Longhand</p>
					<p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
						Add it to your device for quick, app-like access — it works offline too.
					</p>
				</div>
				<button
					type="button"
					onClick={dismiss}
					aria-label="Dismiss install prompt"
					className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
				>
					<span aria-hidden="true" className="block h-4 w-4 text-center text-lg leading-4">
						&times;
					</span>
				</button>
			</div>
			<div className="mt-3 flex justify-end">
				<button
					type="button"
					onClick={() => void install()}
					className="fill-green rounded-md px-4 py-2 text-sm font-medium hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-500"
				>
					Install
				</button>
			</div>
		</section>
	)
}
