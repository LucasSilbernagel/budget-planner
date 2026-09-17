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
import { PROFILE_ICONS, PROFILE_ICON_LABELS, resolveProfileIcon } from '@/lib/profile-appearance'
import { isSyncActive } from '@/lib/sync/syncBridge'
import { useEffect, useRef, useState } from 'react'
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
    // The icon the profile is ALREADY showing — its stored one, or the
    // hash-derived fallback when it has never had one chosen. Seeding the picker
    // with the fallback is what stops the avatar appearing to change the instant
    // the dialog opens. It also means a non-empty value here is not evidence of a
    // choice, which is why `handleSubmit` sends `icon` only when it differs.
    icon: profile ? resolveProfileIcon(profile) : '',
  }))
  const [form, setForm] = useState<ProfileFormState>(initialForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  // One slot per icon option, so the arrow-key handler can move focus under the
  // roving tabindex (the unselected options are not focusable on their own).
  const iconRefs = useRef<(HTMLButtonElement | null)[]>([])

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
    //
    // ⚠️ `icon` MUST be part of this comparison (story 54.2). Without it an
    // icon-only edit matches "unchanged" and closes having saved nothing — and
    // every other test in this file still passes, because they all change the name
    // or the description.
    if (
      form.name === initialForm.name &&
      form.description === initialForm.description &&
      form.icon === initialForm.icon
    ) {
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
      // ⚠️ `icon` is put in the UPDATES OBJECT only when the user actually changed
      // it. The picker opens pre-selected on the hash fallback, so including it
      // unconditionally would stamp that fallback into the database as a
      // deliberate choice every time someone merely renamed a profile — a write
      // the user never made, and one that would outlive any future hash change.
      //
      // ⚠️ PRECISION, corrected by code review 54.2: this is a claim about the
      // UPDATES OBJECT, not about the wire. `updateProfile` syncs
      // `{ ...previous, ...updates }`, so once a profile HAS a stored icon, that
      // icon rides along in the payload of every later edit — and `updateEntity`
      // does a partial `.set()` with no `baseVersion` check, so a stale device can
      // revert a newer choice made elsewhere. That is pre-existing last-write-wins
      // (it applies to `name` and `description` identically) and is logged in
      // `deferred-work.md`; what this guard genuinely prevents is a NEVER-CHOSEN
      // profile acquiring an icon it never had.
      const updates: { name: string; description: string; icon?: string } = {
        name: form.name,
        description: form.description,
      }
      if (form.icon !== initialForm.icon) {
        updates.icon = form.icon
      }
      modifyProfile(profileId, updates)
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

  /**
   * The WAI-ARIA radiogroup keyboard contract for the icon picker (code review
   * 54.2). Arrows move to the adjacent option, wrapping at both ends; Home/End
   * jump to the first/last. Moving SELECTS as it goes, which is the standard
   * behaviour for a radiogroup and what `aria-checked` then announces.
   *
   * Focus is moved explicitly because the roving tabindex leaves the other seven
   * options unfocusable — without this the browser has nowhere to send focus.
   */
  const handleIconKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const count = PROFILE_ICONS.length
    const current = PROFILE_ICONS.findIndex((icon) => icon === form.icon)
    // -1 when the stored value is not one of the eight; start from the first so
    // the keyboard still works on a profile holding an unrecognised icon.
    const from = current === -1 ? 0 : current

    let next: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (from + 1) % count
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (from - 1 + count) % count
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      default:
        return
    }

    // Only now, once we know the key was ours: an unhandled key must keep its
    // default (Tab must still leave the group, Escape must still close the modal).
    e.preventDefault()
    const icon = PROFILE_ICONS[next]
    if (icon) {
      handleChange('icon', icon)
      iconRefs.current[next]?.focus()
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
        {/* Icon picker (story 54.2, FR78) */}
        <div>
          <span id="edit-profile-icon-label" className="block text-sm font-medium text-label mb-1">
            Profile Icon
          </span>
          {/*
            A radiogroup rather than eight independent toggles: exactly one is
            chosen at a time.
            ⚠️ Choosing `role="radio"` OBLIGES us to implement the radiogroup
            keyboard contract, because assistive tech announces "N of 8" and tells
            the user to arrow between options. Code review 54.2 caught this
            promising behaviour the widget did not have. Hence `onKeyDown` below
            and the roving tabindex: exactly ONE option is in the tab order, and
            arrows move (and select) within the group.
          */}
          <div
            role="radiogroup"
            aria-labelledby="edit-profile-icon-label"
            className="flex flex-wrap gap-2"
            onKeyDown={handleIconKeyDown}
          >
            {PROFILE_ICONS.map((icon, index) => {
              const selected = form.icon === icon
              return (
                <button
                  key={icon}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  // ⚠️ An emoji is not an accessible name — see PROFILE_ICON_LABELS.
                  aria-label={PROFILE_ICON_LABELS[icon]}
                  // Roving tabindex: Tab enters the group once, landing on the
                  // selected option, rather than stopping on all eight.
                  tabIndex={selected ? 0 : -1}
                  ref={(el) => {
                    iconRefs.current[index] = el
                  }}
                  onClick={() => handleChange('icon', icon)}
                  className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    selected
                      ? // ⚠️ The selected state must NOT be carried by colour alone
                        // (WCAG 1.4.1). Code review 54.2 found the original pair
                        // differed only in hue — `border-2` was in the shared base
                        // string, and the only ring was `focus:`, i.e. focus state,
                        // not selection state. The BORDER WIDTH now differs (4 vs 2),
                        // which survives both colour-blindness and a monochrome
                        // rendering. `dark:border-blue-300` rather than `-400` lifts
                        // the dark-mode non-text contrast above 1.4.11's 3:1.
                        'border-4 border-blue-600 bg-blue-50 dark:border-blue-300 dark:bg-blue-950/40'
                      : 'border-2 border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500'
                  }`}
                >
                  <span aria-hidden="true">{icon}</span>
                </button>
              )
            })}
          </div>
        </div>

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
