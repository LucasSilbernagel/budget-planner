/**
 * Profiles Page
 *
 * Manage custom financial profiles. Custom profiles is a **Premium** feature
 * (Story 13-3): the route stays reachable, but for a non-active subscription it
 * renders a discoverable, locked upgrade surface instead of the management UI,
 * and the profile server functions independently reject non-active callers. An
 * active (paid) user gets the full create / list / switch experience, synced to
 * DanubeData (Germany - EU) via the existing profile store → sync bridge.
 *
 * Route: /profiles
 *
 * Architecture: TanStack Start; gated via `usePremiumAccess` (the single tier
 * signal shared with ads / PremiumFeatureGate / the forecasting route), so ads,
 * routes, and gates never disagree. Fail-closed: unknown/loading/errored tier is
 * treated as NOT premium.
 */

import { PremiumPrompt } from '@/components/auth/premium-prompt'
import { CreateProfileDialog } from '@/components/profiles/create-profile'
import { ProfileList } from '@/components/profiles/profile-list'
import { SwitchProfileDropdown } from '@/components/profiles/switch-profile'
import { usePremiumAccess } from '@/hooks/usePremiumAccess'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

// Define the route
export const Route = createFileRoute('/profiles')({
  component: ProfilesPage,
})

export function ProfilesPage() {
  const { status } = usePremiumAccess()
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  // Tier not yet known (SSR + first client paint): a neutral loading state.
  // Identical on server and first client render → hydration-safe, and never
  // leaks the management UI to a not-yet-verified user (fail-closed).
  if (status.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div
          role="status"
          aria-label="Loading"
          className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
        />
      </div>
    )
  }

  // Non-active (free / lapsed / unauthenticated / errored) → discoverable but
  // locked: a full-page upgrade surface instead of the management UI. The server
  // functions enforce the same boundary independently (Story 13-3, AC-1/AC-2).
  if (!status.hasAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
        <PremiumPrompt
          featureName="Custom Profiles"
          message="Keep separate sets of finances (e.g. personal vs. household) in custom profiles and switch between them, synced across your devices."
          asDialog={false}
        />
      </div>
    )
  }

  // Active premium: the full management experience (unchanged behavior, AC-3).
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Profiles</h1>
            <p className="text-gray-600 mt-1 dark:text-gray-400">
              Organize your finances with multiple profiles
            </p>
          </div>

          {/* Active profile switcher */}
          <div className="flex items-center gap-4">
            <SwitchProfileDropdown />
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
            >
              + New Profile
            </button>
          </div>
        </div>

        {/* Profile list */}
        <div className="bg-white rounded-xl shadow-md p-6 dark:bg-gray-800">
          <ProfileList onCreateNewProfile={() => setShowCreateDialog(true)} />
        </div>

        {/* Create profile dialog */}
        {showCreateDialog && <CreateProfileDialog onClose={() => setShowCreateDialog(false)} />}

        {/* Info section */}
        <div className="mt-8 bg-blue-50 rounded-xl p-6 dark:bg-blue-950/40">
          <h2 className="text-lg font-semibold text-blue-800 mb-2 dark:text-blue-200">
            About Profiles
          </h2>
          <p className="text-blue-700 dark:text-blue-300">
            Profiles help you organize your financial data for different purposes. Each profile has
            its own set of income, expenses, savings goals, and balance tracking. Switch between
            profiles to view different financial scenarios.
          </p>
          <p className="text-blue-700 mt-2 dark:text-blue-300">
            Your profiles are synchronized across all your devices via DanubeData (Germany - EU).
          </p>
        </div>
      </div>
    </div>
  )
}
