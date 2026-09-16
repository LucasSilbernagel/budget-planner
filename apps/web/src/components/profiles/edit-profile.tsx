/**
 * Edit Profile Dialog Component (story 54.1, FR77)
 *
 * Modal dialog for renaming an existing profile or changing its description.
 * Structurally mirrors `CreateProfileDialog` and shares its validation
 * (`profile-form.ts`), but writes through `useProfileManager().modifyProfile`, so
 * the change is stamped with `updatedAt` and, for a paid session, queued to the
 * server through the existing `userProfile` sync entity.
 *
 * Architecture: React with Tailwind CSS
 * State Management: Zustand via useProfileManager hook
 */

import { useProfileById, useProfileManager, useProfiles } from '@/hooks/useActiveProfile'
import { isSyncActive } from '@/lib/sync/syncBridge'
import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { type ProfileFormState, validateProfileForm } from './profile-form'

interface EditProfileDialogProps {
  /** The profile being edited — not necessarily the active one. */
  profileId: string
  onClose: () => void
}

export function EditProfileDialog({ profileId, onClose }: EditProfileDialogProps) {
  const profile = useProfileById(profileId)
  const profiles = useProfiles()
  const { modifyProfile } = useProfileManager()

  // Captured ONCE, when the dialog opens. It seeds the form, so a background pull
  // that replaces the profile while the dialog is open does not overwrite what the
  // user is typing. It is also the baseline for "did the user change anything":
  // comparing against the LIVE profile would make an untouched Save write the
  // stale name back over a rename pulled from another device.
  const [initialForm] = useState<ProfileFormState>(() => ({
    name: profile?.name ?? '',
    description: profile?.description ?? '',
  }))
  const [form, setForm] = useState<ProfileFormState>(initialForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // The profile can disappear under an open dialog (a pull delivered its
  // tombstone). There is nothing left to edit, so close.
  useEffect(() => {
    if (!profile) {
      onClose()
    }
  }, [profile, onClose])

  if (!profile) {
    return null
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Nothing changed: skip the write so no pointless sync op is queued. Checked
    // BEFORE validation, so a profile whose stored name already collides with
    // another (duplicates merged from two devices) can still be closed with Save.
    if (form.name === initialForm.name && form.description === initialForm.description) {
      onClose()
      return
    }

    // Exclude the profile BEING EDITED, so it can keep its own name.
    const newErrors = validateProfileForm(form, profiles, profileId)
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    // A paid session before its first pull (or offline) still holds the
    // module-seeded bootstrap profile (`userId: ''`), which the server has never
    // seen. An update for it is rejected, and the next pull's reconcile drops the
    // placeholder, so the edit would silently vanish. The free tier (no sync) edits
    // it locally, which is correct.
    if (profile.userId === '' && isSyncActive()) {
      setErrors({ form: 'This profile is still syncing. Please try again in a moment.' })
      return
    }

    setIsSubmitting(true)
    try {
      // Only the two form fields. Currency, isDefault and userId are carried over
      // from the stored profile by `updateProfile`'s merge.
      //
      // ⚠️ `description` stays a string, `''` when cleared — never `undefined`.
      // The sync payload omits a null/undefined description and the server only
      // SETs fields it receives, so `undefined` would leave the OLD description on
      // the server, and the next pull would restore it on every device.
      modifyProfile(profileId, { name: form.name, description: form.description })
    } catch (_error) {
      setErrors({ form: 'Failed to save profile. Please try again.' })
      setIsSubmitting(false)
      return
    }
    // Outside the try: a throw from the parent's close handler is not a failed save.
    onClose()
  }

  const handleChange = (field: keyof ProfileFormState, value: string) => {
    setForm({ ...form, [field]: value })

    if (errors[field]) {
      setErrors({ ...errors, [field]: '' })
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      labelledBy="edit-profile-title"
      className="bg-white dark:bg-gray-800 dark:text-gray-100 rounded-xl shadow-xl w-full max-w-md"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-default">
        <div>
          <h2 id="edit-profile-title" className="text-xl font-bold text-heading">
            Edit Profile
          </h2>
          <p className="text-body mt-1">Update this profile's name or description</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          aria-label="Close"
        >
          <svg
            aria-hidden="true"
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {/* Name field */}
        <div>
          <label htmlFor="edit-profile-name" className="block text-sm font-medium text-label mb-1">
            Profile Name <span className="text-red-500">*</span>
          </label>
          <input
            id="edit-profile-name"
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="e.g., Personal, Business, Investments"
            maxLength={255}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
              errors['name'] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
            }`}
          />
          {errors['name'] && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors['name']}</p>
          )}
        </div>

        {/* Description field */}
        <div>
          <label
            htmlFor="edit-profile-description"
            className="block text-sm font-medium text-label mb-1"
          >
            Description
          </label>
          <textarea
            id="edit-profile-description"
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder="Briefly describe the purpose of this profile (optional)"
            maxLength={500}
            rows={3}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
              errors['description'] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
            }`}
          />
          <p className="text-xs text-muted mt-1 text-right">
            {form.description.length}/500 characters
          </p>
          {errors['description'] && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors['description']}</p>
          )}
        </div>

        {/* Form error */}
        {errors['form'] && (
          <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-300">{errors['form']}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
