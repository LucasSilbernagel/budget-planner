/**
 * Profiles Page
 *
 * Page for managing user profiles in the Budget Planner application.
 * Allows users to create, view, switch, and manage multiple financial profiles.
 *
 * Route: /profiles
 *
 * Architecture: TanStack Start with React Router
 * Data Sovereignty: Client-side storage for free tier, server sync for paid tier
 */

import { CreateProfileDialog } from '@/components/profiles/create-profile'
import { ProfileList } from '@/components/profiles/profile-list'
import { SwitchProfileDropdown } from '@/components/profiles/switch-profile'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

// Define the route
export const Route = createFileRoute('/profiles')({
  component: ProfilesPage,
})

function ProfilesPage() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Profiles</h1>
            <p className="text-gray-600 mt-1">Organize your finances with multiple profiles</p>
          </div>

          {/* Active profile switcher */}
          <div className="flex items-center gap-4">
            <SwitchProfileDropdown />
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              + New Profile
            </button>
          </div>
        </div>

        {/* Profile list */}
        <div className="bg-white rounded-xl shadow-md p-6">
          <ProfileList onCreateNewProfile={() => setShowCreateDialog(true)} />
        </div>

        {/* Create profile dialog */}
        {showCreateDialog && <CreateProfileDialog onClose={() => setShowCreateDialog(false)} />}

        {/* Info section */}
        <div className="mt-8 bg-blue-50 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-blue-800 mb-2">About Profiles</h2>
          <p className="text-blue-700">
            Profiles help you organize your financial data for different purposes. Each profile has
            its own set of income, expenses, savings goals, and balance tracking. Switch between
            profiles to view different financial scenarios.
          </p>
          <p className="text-blue-700 mt-2">
            <strong>Free Tier:</strong> Profile data is stored locally on this device only.
          </p>
          <p className="text-blue-700">
            <strong>Paid Tier:</strong> Profile data is synchronized across all your devices via
            DanubeData (Germany - EU).
          </p>
        </div>
      </div>
    </div>
  )
}
