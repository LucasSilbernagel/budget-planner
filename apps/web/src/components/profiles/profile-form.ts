/**
 * Profile form contract shared by the create and edit dialogs (story 54.1).
 *
 * The two dialogs collect the same fields under the same rules; the only
 * difference is which profile the name-uniqueness check ignores:
 * - `CreateProfileDialog` passes `null`. A new profile has no id, so EVERY
 *   existing profile's name counts. (It used to exclude the ACTIVE profile, which
 *   let a new profile take the active profile's name.)
 * - `EditProfileDialog` passes the id of the profile being edited, so a profile
 *   can be saved under its own name. Not the active id: the profile being edited
 *   is not necessarily the active one.
 *
 * ⚠️ Currency is deliberately NOT a form field (Lucas, 2026-09-16). A profile's
 * currency is read for display nowhere but the profile card row story 54.5
 * removes, so an editable field would have no effect. The data model and sync
 * schema keep the column; new profiles are created with `'NONE'`.
 */

import type { ClientProfile } from '@/hooks/useActiveProfile'

export interface ProfileFormState {
  name: string
  description: string
}

export const EMPTY_PROFILE_FORM: ProfileFormState = {
  name: '',
  description: '',
}

/** Returns a field → message map; an empty object means the form is valid. */
export function validateProfileForm(
  form: ProfileFormState,
  profiles: readonly ClientProfile[],
  excludeProfileId: string | null
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!form.name.trim()) {
    errors['name'] = 'Profile name is required'
  } else if (form.name.length > 255) {
    errors['name'] = 'Profile name must be 255 characters or less'
  } else if (profiles.some((p) => p.name === form.name && p.id !== excludeProfileId)) {
    errors['name'] = 'A profile with this name already exists'
  }

  if (form.description.length > 500) {
    errors['description'] = 'Description must be 500 characters or less'
  }

  return errors
}
