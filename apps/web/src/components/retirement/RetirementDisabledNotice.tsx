import { Link } from '@tanstack/react-router'
import type React from 'react'
import { useSetShowRetirementPlanner } from '../../stores/plannerVisibilityStore'

/**
 * The `/retirement` off-state (story 35.2, FR55, AC-5).
 *
 * Rendered in place of the planner when the user has hidden it in Settings.
 * This is the in-place gate pattern the app already uses for premium-locked
 * routes (`routes/forecasting.tsx` renders `<PremiumPrompt>` instead of its
 * content rather than redirecting) — chosen deliberately over a route guard:
 * there is no `beforeLoad`/`redirect()` anywhere in this app, a redirect would
 * bounce the user with no explanation, and it would turn the in-app doc link at
 * `content/docs/getting-started.md` into a dead end.
 *
 * ⚠️ The copy states plainly that nothing was deleted, because the control that
 * leads here sits next to "Clear local data" on the same Settings page and the
 * two must not be confused. It is also true in the strongest sense: the planner
 * holds no persisted inputs at all, and the income/expense/balance stores it
 * reads are never written by this feature.
 */
export function RetirementDisabledNotice(): React.ReactElement {
  const setShowRetirementPlanner = useSetShowRetirementPlanner()

  return (
    <div className="min-h-screen surface-sunken py-6 sm:py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto surface rounded-2xl shadow-lg p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-heading mb-4">
          The Retirement planner is turned off
        </h1>
        <p className="text-base text-body mb-4">
          You hid this planner in Settings, so it has been removed from your navigation.
        </p>
        <p className="text-base text-body mb-8">
          Nothing was deleted. Your income, expenses, savings and balances are exactly as you left
          them, and the planner will work as before if you turn it back on.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <button
            type="button"
            onClick={() => setShowRetirementPlanner(true)}
            className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Turn the planner back on
          </button>
          <Link
            to="/settings"
            className="text-sm font-medium text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-md"
          >
            Go to Settings
          </Link>
        </div>
      </div>
    </div>
  )
}
