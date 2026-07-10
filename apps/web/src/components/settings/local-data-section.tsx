import { purgeLocalFinancialData } from '@/lib/account/purge-local-financial-data'
import { useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/**
 * "Clear local data" control on the consolidated `/settings` surface (Story 17-2).
 *
 * A one-click, all-users reset of the data Budget Planner stores in THIS browser
 * (income, expenses, savings, balances, profiles, and — for a signed-in user —
 * the durable sync queue). Deliberately distinct from {@link AccountSection}'s
 * "Delete account", which is Premium-only and erases the SERVER-side account:
 *   - it renders for EVERYONE, including free / unauthenticated visitors (AC-1),
 *     so it is NOT auth-gated the way AccountSection self-hides;
 *   - it touches only local storage — no server call — so it is styled as a
 *     neutral utility, not a red danger zone.
 *
 * The purge itself is the shared `purgeLocalFinancialData` (reused from Story
 * 10-5); it resets the Zustand stores synchronously so any subscribed view
 * updates immediately (AC-3). Because `/settings` shows no financial figures of
 * its own, a `role="status"` line confirms the wipe happened.
 *
 * The userId (needed ONLY to clear the paid-tier sync queue when signed in) is
 * resolved at CONFIRM time via a best-effort `fetch('/api/auth/me')` — NOT
 * prefetched into state — so a signed-in user who confirms quickly can never
 * purge with a stale `undefined` and silently leave the queue behind. This
 * mirrors AccountSection's session pattern (plain fetch, no react-query, no
 * client-bundled `checkPremiumAccessServer` "Buffer is not defined" hazard); a
 * free user (no session) resolves to `undefined`, which skips the queue step.
 */

async function fetchCurrentUserId(): Promise<string | undefined> {
  try {
    const response = await fetch('/api/auth/me')
    if (!response.ok) {
      return undefined
    }
    const data = (await response.json()) as { user?: { userId?: string } | null }
    return data.user?.userId ?? undefined
  } catch {
    // Best-effort: no session (or a network hiccup) just means no queue to clear.
    return undefined
  }
}

export function LocalDataSection() {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [cleared, setCleared] = useState(false)

  const handleConfirm = async (): Promise<void> => {
    setIsClearing(true)
    try {
      // Resolve the userId HERE (not from prefetched state) so a signed-in user
      // who confirms quickly still clears their sync queue. Free / unauthenticated
      // users resolve to `undefined`, which skips the queue step. Both the fetch
      // and the purge are best-effort and never throw, but `finally` guarantees the
      // dialog can never wedge in the "Clearing…" state even if that ever changes.
      const userId = await fetchCurrentUserId()
      await purgeLocalFinancialData(userId)
      setCleared(true)
    } finally {
      setIsClearing(false)
      setIsConfirmOpen(false)
    }
  }

  const statusClassName = `text-sm font-medium text-green-700 dark:text-green-400${
    cleared ? ' mt-3' : ''
  }`

  return (
    <section
      aria-labelledby="settings-local-data-heading"
      className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
    >
      <h2
        id="settings-local-data-heading"
        className="text-lg font-semibold text-gray-900 dark:text-gray-100"
      >
        Local data
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Removes the income, expenses, savings, balances and profiles stored in this browser. This
        only affects this device and does not delete any synced account.
      </p>
      <button
        type="button"
        onClick={() => {
          setCleared(false)
          setIsConfirmOpen(true)
        }}
        className="mt-3 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        Clear local data
      </button>
      {/* Live region rendered unconditionally (not mounted on success) so screen
          readers reliably announce the confirmation when its text appears. The
          margin is applied only when populated so the empty region adds no gap. */}
      <p role="status" className={statusClassName}>
        {cleared ? 'Your local data has been cleared from this device.' : ''}
      </p>

      {/* No finalFocusRef: the trigger button is not removed on confirm, so
          Modal's default restores focus to it (a non-focusable <section> would
          drop focus to <body>). */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onConfirm={handleConfirm}
        onCancel={() => setIsConfirmOpen(false)}
        title="Clear local data?"
        confirmLabel={isClearing ? 'Clearing…' : 'Clear data'}
        isConfirming={isClearing}
        message="This permanently removes your locally stored entries (income, expenses, savings, balances and profiles) from this device. It cannot be undone."
      />
    </section>
  )
}
