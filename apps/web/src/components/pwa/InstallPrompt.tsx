import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The `beforeinstallprompt` event (story 17-1).
 *
 * Chromium fires this on `window` once the app meets its installability
 * criteria (a valid manifest + a registered service worker — both shipped by
 * story 7-1 — plus the browser's own engagement heuristics). It is not part of
 * the standard DOM lib types, so it is declared locally. No `any` (project rule).
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

/** localStorage key holding the epoch-ms timestamp of the last dismissal. */
const DISMISSAL_STORAGE_KEY = 'bp-pwa-install-dismissed'

/**
 * How long a dismissal suppresses the affordance (30 days). Long enough that a
 * user who declines is not nagged, short enough that a returning user is
 * eventually reminded (AC-2).
 */
const DISMISSAL_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * True when the app is already installed / launched from the home screen, so
 * the install affordance would be meaningless. Checks the standard
 * `display-mode: standalone` media query and iOS Safari's non-standard
 * `navigator.standalone`. Defensive: `matchMedia` is absent under SSR/jsdom and
 * can throw on a malformed query in some engines.
 */
function isRunningStandalone(): boolean {
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

/**
 * True when the user dismissed the affordance within the suppression interval.
 * Any storage failure (Safari private mode `SecurityError`) or corrupt value is
 * swallowed and treated as "not dismissed" — mirrors the store-hydration
 * discipline; a blocked store must never throw or wrongly suppress forever.
 */
function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSAL_STORAGE_KEY)
    if (!raw) {
      return false
    }
    const dismissedAt = Number.parseInt(raw, 10)
    // Reject non-finite AND future timestamps: a future `dismissedAt` (clock
    // skew, or a corrupt-but-finite value) yields a negative delta that is
    // always < the interval, which would suppress the affordance essentially
    // forever. `Number.isFinite` alone does not catch that.
    if (!Number.isFinite(dismissedAt) || dismissedAt > Date.now()) {
      return false
    }
    return Date.now() - dismissedAt < DISMISSAL_INTERVAL_MS
  } catch {
    return false
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISSAL_STORAGE_KEY, Date.now().toString())
  } catch {
    // Blocked/full storage: the dismissal simply will not persist across visits.
  }
}

/**
 * Unobtrusive, dismissible affordance telling installable-browser users they can
 * install Budget Planner (story 17-1, FR29). Builds on the manifest + service
 * worker from story 7-1 — this adds only the affordance.
 *
 * Client-only and SSR-safe (mirrors {@link import('./RegisterSW').RegisterSW}):
 * all `window`/`navigator`/`localStorage` access happens inside effects, and the
 * component renders nothing on the server and the first client render, only
 * appearing after a `beforeinstallprompt` event — so there is no hydration
 * mismatch. On browsers that never fire the event (iOS Safari) or when already
 * installed, it stays hidden and shows no broken button (AC-3).
 */
export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const affordanceRef = useRef<HTMLElement>(null)

  useEffect(() => {
    // Never subscribe if the affordance should stay hidden this visit.
    if (isRunningStandalone() || wasRecentlyDismissed()) {
      return
    }

    const onBeforeInstallPrompt = (event: Event) => {
      // Suppress Chromium's default mini-infobar; we drive our own affordance.
      event.preventDefault()
      // Re-check suppression per event, not just at mount: the subscription
      // lives for the component's lifetime, so a same-session re-fire after the
      // user has dismissed must not pop the affordance back up.
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

  // Escape-to-dismiss (AC-4). A window-level listener works regardless of where
  // focus sits, and only lives while the affordance is shown.
  useEffect(() => {
    if (!promptEvent) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // Only dismiss when focus sits within the affordance (spec: "when the
      // affordance holds focus"), so an Escape meant for unrelated UI never
      // dismisses the banner or writes a 30-day suppression.
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
    // The captured event can only be prompted once — hide the affordance now,
    // regardless of the user's choice in the native dialog.
    setPromptEvent(null)
    try {
      await event.prompt()
      const choice = await event.userChoice
      if (choice.outcome === 'dismissed') {
        // Declining the native dialog counts as a dismissal for nag-suppression.
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
      aria-label="Install Budget Planner"
      className="fixed bottom-16 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-4 shadow-lg sm:bottom-4 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            Install Budget Planner
          </p>
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
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-green-500 dark:hover:bg-green-600"
        >
          Install
        </button>
      </div>
    </section>
  )
}
