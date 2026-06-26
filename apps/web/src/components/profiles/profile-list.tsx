/**
 * Profile List Component
 *
 * Displays a list of user profiles with options to manage them.
 * Shows active profile indicator and allows switching between profiles.
 *
 * Architecture: React with Tailwind CSS
 * State Management: Zustand via useActiveProfile hook
 */

import {
  useHasMultipleProfiles,
  useProfileManager,
  useProfilesWithActive,
} from '@/hooks/useActiveProfile'
import type { ClientProfile } from '@/hooks/useActiveProfile'
import { useState } from 'react'

// Profile color options for visual distinction
const PROFILE_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-pink-500',
]

// Profile icon options (simple SVG icons)
const PROFILE_ICONS = ['🏠', '💼', '💰', '🎯', '📈', '🔒', '🌱', '✈️']

// Format date for display (module-scoped so both ProfileList and ProfileCard can use it)
const formatDate = (dateString: string) => {
  // Validate date string before parsing
  if (!dateString) return 'Invalid date'

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return 'Invalid date'

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface ProfileListProps {
  onCreateNewProfile?: () => void
}

export function ProfileList({ onCreateNewProfile }: ProfileListProps) {
  const { profiles, activeProfileId } = useProfilesWithActive()
  const { deleteProfile } = useProfileManager()
  const hasMultipleProfiles = useHasMultipleProfiles()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Handle profile deletion
  const handleDelete = async (profileId: string) => {
    if (deletingId) return // Prevent multiple simultaneous deletions

    setDeletingId(profileId)

    try {
      await deleteProfile(profileId)
    } finally {
      setDeletingId(null)
    }
  }

  // Get color for a profile (consistent based on ID hash)
  const getProfileColor = (profileId: string) => {
    // Use a simple hash of the UUID to get a consistent index
    // Handle empty profileId gracefully
    if (!profileId) return PROFILE_COLORS[0]

    let hash = 0
    for (let i = 0; i < profileId.length; i++) {
      hash = (hash << 5) - hash + profileId.charCodeAt(i)
      hash |= 0 // Convert to 32-bit integer
    }
    return PROFILE_COLORS[Math.abs(hash) % PROFILE_COLORS.length]
  }

  // Get icon for a profile (consistent based on ID hash)
  const getProfileIcon = (profileId: string) => {
    // Use a simple hash of the UUID to get a consistent index
    // Handle empty profileId gracefully
    if (!profileId) return PROFILE_ICONS[0]

    let hash = 0
    for (let i = 0; i < profileId.length; i++) {
      hash = (hash << 5) - hash + profileId.charCodeAt(i)
      hash |= 0 // Convert to 32-bit integer
    }
    return PROFILE_ICONS[Math.abs(hash) % PROFILE_ICONS.length]
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Your Profiles</h2>
        <span className="text-sm text-gray-500">
          {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-4">No profiles yet</p>
          <button
            type="button"
            onClick={onCreateNewProfile ? onCreateNewProfile : () => {}}
            disabled={!onCreateNewProfile}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Your First Profile
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              isActive={profile.id === activeProfileId}
              isDeleting={deletingId === profile.id}
              onDelete={() => handleDelete(profile.id)}
              color={getProfileColor(profile.id)}
              icon={getProfileIcon(profile.id)}
            />
          ))}
        </div>
      )}

      {/* Multiple profiles notice */}
      {!hasMultipleProfiles && (
        <div className="mt-6 p-4 bg-gray-100 rounded-lg">
          <p className="text-sm text-gray-600">
            💡 <strong>Tip:</strong> Create additional profiles to organize your finances for
            different purposes (e.g., personal, business, investments).
          </p>
        </div>
      )}
    </div>
  )
}

// Individual profile card component
interface ProfileCardProps {
  profile: ClientProfile
  isActive: boolean
  isDeleting: boolean
  onDelete: () => void
  color: string
  icon: string
}

function ProfileCard({ profile, isActive, isDeleting, onDelete, color, icon }: ProfileCardProps) {
  const { switchToProfile } = useProfileManager()
  const hasMultipleProfiles = useHasMultipleProfiles()

  return (
    <div
      className={`bg-white border rounded-xl p-5 transition-all duration-200 ${
        isActive
          ? 'border-blue-500 shadow-lg shadow-blue-500/10'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      {/* Profile header */}
      <div className="flex items-start gap-3 mb-3">
        {/* Profile icon */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xl ${color}`}
        >
          {icon}
        </div>

        {/* Profile info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{profile.name}</h3>
            {profile.isDefault && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                Default
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 truncate">
            {profile.description || 'No description'}
          </p>
        </div>
      </div>

      {/* Profile meta */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Currency:</span>
          <span className="font-medium text-gray-900">{profile.currency || 'NONE'}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Created:</span>
          <span className="font-medium text-gray-900">{formatDate(profile.createdAt)}</span>
        </div>
      </div>

      {/* Active indicator */}
      {isActive && (
        <div className="mt-4 flex items-center gap-2 text-sm text-green-600">
          <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>Active Profile</span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2">
        {!isActive && (
          <button
            type="button"
            onClick={() => switchToProfile(profile.id)}
            className="text-sm text-blue-600 hover:text-blue-700 transition-colors"
          >
            Switch to
          </button>
        )}

        {/* Delete button - only for non-default, non-last profiles */}
        {!profile.isDefault && hasMultipleProfiles && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="text-sm text-red-600 hover:text-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  )
}
