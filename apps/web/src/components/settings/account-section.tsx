import { planLabel } from '@/lib/account/plan-label'
import { purgeLocalFinancialData } from '@/lib/account/purge-local-financial-data'
import { returnToSignedOutHome, signOut } from '@/lib/account/sign-out'
import type { BillingInterval, SubscriptionStatus } from '@budget-planner/db/src/schema'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/**
 * Account controls on the consolidated `/settings` surface (Story 10-5).
 *
 * Home for the self-serve account-deletion control (AC-4), folded into the
 * story 11-6 settings surface rather than a standalone `/account` route
 * (resolved decision #1, 2026-07-04). Also surfaces sign-out — before this
 * there was NO signed-in place to log out. This component uses a plain
 * `fetch('/api/auth/me')` rather than react-query (the app mounts no
 * `QueryClientProvider`), which also avoids the client-bundled
 * `checkPremiumAccessServer` "Buffer is not defined" hazard. The same
 * fetch pattern backs the persistent `AuthIndicator` (story 13-2).
 *
 * AC-4: the whole section renders ONLY for an authenticated user — free /
 * unauthenticated visitors (and the pre-resolution loading state) see nothing,
 * so the destructive control is never exposed to them (fail-closed).
 */

interface CurrentUser {
  userId: string
  email: string
  subscriptionStatus: SubscriptionStatus
  /**
   * Story 70.1. Optional because a server that predates the field (a rolling
   * deploy) omits it; absent is read as "not known" — "Active" for an active
   * subscriber, "Payment overdue" for a past-due one (see `planLabel`).
   */
  billingInterval?: BillingInterval | null
}

/**
 * Statuses that carry live paid access — the ones for which deleting the
 * account actually forfeits something (Story 5-19, AC-6). `canceled` is absent:
 * that subscription has already ended, so there is nothing left to forfeit.
 */
const PAID_ACCESS_STATUSES: readonly string[] = ['active', 'past_due', 'lifetime']

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: CurrentUser }

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch('/api/auth/me')
  if (!response.ok) {
    return null
  }
  const data = (await response.json()) as { user?: CurrentUser | null }
  return data.user ?? null
}

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
        // Fail closed: any failure resolving the session hides the controls.
        if (active) {
          setAuthState({ status: 'unauthenticated' })
        }
      })
    return () => {
      active = false
    }
  }, [])

  // Sign-out is the shared implementation in `lib/account/sign-out.ts` (story
  // 59.3), also called by the chrome's account menu. Its docblock records why
  // it is a full document load and not a client-side navigation.
  const [isSigningOut, setIsSigningOut] = useState(false)
  const handleSignOut = async (): Promise<void> => {
    // No re-entry guard here: `disabled` stops a second click and `signOut()`
    // dedupes at module level (which is also what stops the chrome's Sign out
    // from firing a second POST while this one is in flight).
    setIsSigningOut(true)
    try {
      await signOut()
    } finally {
      // Reset, so a sign-out that timed out rather than navigating leaves the
      // button usable (review: a hung POST disabled it permanently).
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

    // Phase 1: the server call. A failure HERE means nothing was deleted — show
    // the inline error and close the dialog so it is not occluded by the overlay.
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

    // Phase 2: past this point the account is IRREVERSIBLY deleted server-side
    // and the session cookie is cleared. Local cleanup + sign-out are
    // best-effort and must NEVER be reported as a deletion failure. No setState
    // after navigation (the component unmounts on redirect).
    // AC-5: purge locally persisted financial data (incl. the durable sync queue)
    // so a signed-out browser does not still show/retain the deleted numbers.
    await purgeLocalFinancialData(userId)
    setIsConfirmOpen(false)
    try {
      returnToSignedOutHome()
    } catch (error) {
      // Account is already gone; a redirect hiccup must not become a false error.
      console.error('Account deleted, but sign-out redirect failed', error)
    }
  }

  // AC-4: never render the destructive control for unauthenticated/loading.
  if (authState.status !== 'authenticated') {
    return null
  }

  // Story 5-19 AC-6: deletion cancels the Paddle subscription with
  // `effective_from: 'immediately'`, so remaining paid time is forfeited. The
  // product decision was to KEEP that (a subscription outliving its deleted
  // user row lets a later webhook resurrect the account) and to say so plainly
  // instead. Shown only to someone who actually HAS paid access — telling a
  // free or already-cancelled user their subscription is about to end would be
  // a lie about their own account.
  const hasPaidAccess = PAID_ACCESS_STATUSES.includes(authState.user.subscriptionStatus)
  const billingForfeitureNotice = hasPaidAccess
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
            {/* Story 70.1: the plan NAME, not the raw status enum — which is what
                made monthly and annual both read "Active", and (through CSS
                `capitalize`) rendered `past_due` as "Past_due". */}
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {planLabel(authState.user.subscriptionStatus, authState.user.billingInterval)}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:text-gray-300 dark:hover:bg-gray-700"
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
            className="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:bg-red-500 dark:hover:bg-red-600"
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
