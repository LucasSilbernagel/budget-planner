/**
 * Profile List Component
 *
 * Displays a list of user profiles with options to manage them.
 * Shows the active-profile indicator and offers Edit/Delete per card. It does NOT
 * switch profiles: since story 54.3 (FR80) `SwitchProfileDropdown` is the app's
 * one profile-switching control.
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
import { profileColor, resolveProfileIcon } from '@/lib/profile-appearance'
import { useState } from 'react'
import { EditProfileDialog } from './edit-profile'

// ⚠️ No `formatDate` and no `canonicalizeCurrency` import since story 54.5
// (UX-DR60): the card's "Currency:" and "Created:" meta rows were its only
// callers, so both became dead the moment those rows went. `canonicalizeCurrency`
// itself lives on — `stores/profileStore.ts` and `stores/currencyStore.ts` still
// use it, and `packages/core/src/format/__tests__/currency.test.ts` still proves
// the CAD/AUD/MXN -> USD consolidation directly. Only this file's import is gone.

interface ProfileListProps {
  onCreateNewProfile?: () => void
}

export function ProfileList({ onCreateNewProfile }: ProfileListProps) {
  const { profiles, activeProfileId } = useProfilesWithActive()
  const { deleteProfile } = useProfileManager()
  const hasMultipleProfiles = useHasMultipleProfiles()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // The profile whose Edit dialog is open (story 54.1) — any profile, not only the active one.
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)

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

  // Get icon for a profile (consistent based on ID hash)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-heading">Your Profiles</h2>
        <span className="text-sm text-muted">
          {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted mb-4">No profiles yet</p>
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              isActive={profile.id === activeProfileId}
              isDeleting={deletingId === profile.id}
              onDelete={() => handleDelete(profile.id)}
              onEdit={() => setEditingProfileId(profile.id)}
              color={profileColor(profile.id)}
              icon={resolveProfileIcon(profile)}
            />
          ))}
        </div>
      )}

      {editingProfileId && (
        <EditProfileDialog
          // Keyed so switching straight from one profile to another re-seeds the
          // form. `Modal` does not inert the background, so another card's Edit
          // stays reachable while a dialog is open (code review 54.1).
          key={editingProfileId}
          profileId={editingProfileId}
          onClose={() => setEditingProfileId(null)}
        />
      )}

      {/* Multiple profiles notice */}
      {!hasMultipleProfiles && (
        <div className="mt-6 p-4 surface-inset rounded-lg">
          <p className="text-sm text-body">
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
  onEdit: () => void
  color: string
  icon: string
}

function ProfileCard({
  profile,
  isActive,
  isDeleting,
  onDelete,
  onEdit,
  color,
  icon,
}: ProfileCardProps) {
  const hasMultipleProfiles = useHasMultipleProfiles()

  return (
    <div
      className={`surface border rounded-xl p-5 transition-all duration-200 ${
        isActive
          ? 'border-blue-500 shadow-lg shadow-blue-500/10'
          : 'border-default hover:border-gray-300 dark:hover:border-gray-600'
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
            <h3 className="font-semibold text-heading truncate">{profile.name}</h3>
            {profile.isDefault && (
              <span className="text-xs surface-inset text-body px-2 py-0.5 rounded-full">
                Default
              </span>
            )}
          </div>
          <p className="text-sm text-muted truncate">{profile.description || 'No description'}</p>
        </div>
      </div>

      {/* No "Currency:" / "Created:" meta rows since story 54.5 (UX-DR60). Neither
          told the user anything actionable: a profile's currency is not read for
          display formatting anywhere (story 54.1 checked, which is why the create
          and edit dialogs dropped the field), and its creation date never drove a
          decision. The card is name, description, status and actions. */}

      {/* Active indicator */}
      {isActive && (
        <div className="mt-4 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
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

      {/* Actions — status display plus Edit/Delete. The card is deliberately NOT a
          switcher (story 54.3, FR80): `SwitchProfileDropdown` is the app's one
          profile-switching control, so a per-card "Switch to" was a second way to
          do the same thing. */}
      <div className="mt-4 pt-4 border-t border-default flex items-center gap-2">
        {/* Edit button - every profile, including the default and a lone one (story 54.1).
            The profile's name is in the accessible name so several cards' Edit
            buttons are distinguishable; the visible "Edit" is contained in it. */}
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${profile.name}`}
          className="text-sm text-accent hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
        >
          Edit
        </button>

        {/* Delete button - only for non-default, non-last profiles */}
        {!profile.isDefault && hasMultipleProfiles && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  )
}
