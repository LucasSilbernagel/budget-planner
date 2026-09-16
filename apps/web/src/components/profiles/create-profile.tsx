/**
 * Create Profile Dialog Component
 *
 * Modal dialog for creating a new user profile.
 * Includes form validation and handles profile creation.
 *
 * Architecture: React with Tailwind CSS
 * State Management: Zustand via useProfileManager hook
 */

import { useProfileManager, useProfiles } from '@/hooks/useActiveProfile'
import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { EMPTY_PROFILE_FORM, type ProfileFormState, validateProfileForm } from './profile-form'

// ⚠️ No currency field (story 54.1, Lucas 2026-09-16). The picker this dialog
// carried since story 8-2 was removed: a profile's currency is displayed nowhere
// but the card row story 54.5 deletes, so choosing one had no effect. New profiles
// are created with `'NONE'`, which was the picker's default.

interface CreateProfileDialogProps {
  onClose: () => void
}

export function CreateProfileDialog({ onClose }: CreateProfileDialogProps) {
  const [form, setForm] = useState<ProfileFormState>(EMPTY_PROFILE_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const { createProfile } = useProfileManager()
  const profiles = useProfiles()

  // Auto-focus the name field on mount
  useEffect(() => {
    // This would auto-focus in a real implementation
    // For now, we just ensure the dialog is visible
  }, [])

  // Reset form when dialog opens (mount)
  useEffect(() => {
    setForm(EMPTY_PROFILE_FORM)
    setErrors({})
    setSuccess(false)
    setIsSubmitting(false)
  }, [])

  // Form validation. `null`: a new profile has no id, so every existing name
  // counts — including the active profile's (story 54.1).
  const validate = (): boolean => {
    const newErrors = validateProfileForm(form, profiles, null)
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) return

    setIsSubmitting(true)

    try {
      // Create the profile
      // For now, we use a temporary userId - in production this would come from auth
      const userId = localStorage.getItem('userId') || 'temp-user'

      createProfile({
        ...form,
        // No currency field any more (story 54.1): new profiles carry the
        // currency-less sentinel, the former picker's default.
        currency: 'NONE',
        userId,
        // ⚠️ Required by `ClientProfile`, and it was never supplied — so every
        // profile created through this form persisted `isDefault: undefined`.
        // Harmless in practice (every consumer treats it as falsy, and the sync
        // schema defaults it to `false` at `server/api/sync.ts:237`), but the
        // record was malformed. A profile created here is never the default.
        isDefault: false,
      })

      // Mark as default if it's the first profile
      // In production, this would be handled server-side for paid tier

      setSuccess(true)

      // Close after a brief delay to show success message
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (_error) {
      setErrors({ ...errors, form: 'Failed to create profile. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle input change
  const handleChange = (field: keyof ProfileFormState, value: string) => {
    setForm({ ...form, [field]: value })

    // Clear error for this field
    if (errors[field]) {
      setErrors({ ...errors, [field]: '' })
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      labelledBy="create-profile-title"
      className="bg-white dark:bg-gray-800 dark:text-gray-100 rounded-xl shadow-xl w-full max-w-md"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-default">
        <div>
          <h2 id="create-profile-title" className="text-xl font-bold text-heading">
            Create New Profile
          </h2>
          <p className="text-body mt-1">Organize your finances for different purposes</p>
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
        {success ? (
          <div className="text-center py-8">
            <svg
              aria-hidden="true"
              className="w-12 h-12 text-green-500 mx-auto mb-4"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <h3 className="text-lg font-semibold text-green-800 dark:text-green-300">
              Profile Created!
            </h3>
            <p className="text-green-600 dark:text-green-400 mt-2">
              Your new profile has been created and is ready to use.
            </p>
          </div>
        ) : (
          <>
            {/* Name field */}
            <div>
              <label htmlFor="profile-name" className="block text-sm font-medium text-label mb-1">
                Profile Name <span className="text-red-500">*</span>
              </label>
              <input
                id="profile-name"
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
                htmlFor="profile-description"
                className="block text-sm font-medium text-label mb-1"
              >
                Description
              </label>
              <textarea
                id="profile-description"
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
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  {errors['description']}
                </p>
              )}
            </div>

            {/* Info message */}
            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-lg">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                💡 <strong>Note:</strong> This profile will initially contain no financial data. You
                can add income, expenses, and other data after creating it.
              </p>
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
                {isSubmitting ? 'Creating...' : 'Create Profile'}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  )
}
