import type { ClientProfile } from '@/stores/profileStore'

export type ProfileFormState = {
	name: string
	description: string
	icon: string
}

export const EMPTY_PROFILE_FORM: ProfileFormState = {
	name: '',
	description: '',
	icon: '',
}

// No icon rule: the picker is a closed set; untrusted values are handled at render by resolveProfileIcon.
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
