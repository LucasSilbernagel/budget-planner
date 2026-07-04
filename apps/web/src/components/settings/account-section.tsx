import { purgeLocalFinancialData } from '@/lib/account/purge-local-financial-data'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/**
 * Account controls on the consolidated `/settings` surface (Story 10-5).
 *
 * Home for the self-serve account-deletion control (AC-4), folded into the
 * story 11-6 settings surface rather than a standalone `/account` route
 * (resolved decision #1, 2026-07-04). Also surfaces sign-out — before this
 * there was NO signed-in place to log out (the `AuthStatus` component was
 * orphaned; the app has no `QueryClientProvider`, so it could not be rendered
 * as-is). This component therefore uses a plain `fetch('/api/auth/me')` rather
 * than react-query, which also avoids the client-bundled `checkPremiumAccessServer`
 * "Buffer is not defined" hazard.
 *
 * AC-4: the whole section renders ONLY for an authenticated user — free /
 * unauthenticated visitors (and the pre-resolution loading state) see nothing,
 * so the destructive control is never exposed to them (fail-closed).
 */

interface CurrentUser {
  userId: string
  email: string
  subscriptionStatus: string
}

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
  const router = useRouter()
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

  const signOutTo = async (): Promise<void> => {
    await router.invalidate()
    await router.navigate({ to: '/' })
  }

  const handleSignOut = async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      await signOutTo()
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
      await signOutTo()
    } catch (error) {
      // Account is already gone; a redirect hiccup must not become a false error.
      console.error('Account deleted, but sign-out redirect failed', error)
    }
  }

  // AC-4: never render the destructive control for unauthenticated/loading.
  if (authState.status !== 'authenticated') {
    return null
  }

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
            <span className="text-xs capitalize text-gray-500 dark:text-gray-400">
              {authState.user.subscriptionStatus}
            </span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Sign out
          </button>
        </div>

        <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
          <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Delete account</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300/80">
            Permanently deletes your account and all synced financial data. This cannot be undone.
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
        message="This permanently deletes your account and all synced data (income, expenses, savings goals, balances, and profiles). This cannot be undone."
      />
    </section>
  )
}
