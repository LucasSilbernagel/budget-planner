import { useCallback, useEffect, useState } from 'react'
import {
  markAccountNoticeDismissedOnDocument,
  rememberAccountNoticeDismissal,
  wasAccountNoticeDismissed,
} from '../../lib/overview/account-notice-dismissal'

// The border is what makes this a box in light mode: `surface-inset` equals the canvas colour there.
// Keep each <p> sentence a single-line JSX text child: an SSR HTML substring test pins it.
export function AccountNoticeBox() {
  // Not a lazy initializer: reading storage during render would mismatch the server's always-present box.
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (wasAccountNoticeDismissed()) {
      setDismissed(true)
    }
  }, [])

  // Marks <html> so a later same-document remount stays hidden pre-paint. Safe one-way:
  // dismissal has no undo.
  const dismiss = useCallback(() => {
    rememberAccountNoticeDismissal()
    markAccountNoticeDismissedOnDocument()
    setDismissed(true)
  }, [])

  if (dismissed) {
    return null
  }

  return (
    <div
      data-account-notice
      className="surface-inset mt-4 rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-700"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body">
            No account needed · Optional sync is EU-hosted · No bank connection.
          </p>
          <p className="text-muted mt-1">
            Intentional budgeting without bank sync or AI integrations.
          </p>
        </div>
        {/* `min-h-7 min-w-7` is a WCAG 2.5.8 target-size floor, not styling. */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss privacy notice"
          className="text-muted -mr-1 -mt-1 flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-md hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            &times;
          </span>
        </button>
      </div>
    </div>
  )
}
