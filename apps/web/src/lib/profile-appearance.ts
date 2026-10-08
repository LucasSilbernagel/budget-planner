/**
 * The hash must stay stable: changing it reshuffles every profile's avatar. `icon` has no DB CHECK,
 * so `isProfileIcon` enforces the set at render.
 */

const PROFILE_COLORS = [
	'bg-blue-500',
	'bg-green-500',
	'bg-purple-500',
	'bg-orange-500',
	'bg-red-500',
	'bg-teal-500',
	'bg-indigo-500',
	'bg-pink-500',
] as const

/** `profileIcon` indexes by hash, so the order is load-bearing. */
export const PROFILE_ICONS = ['🏠', '💼', '💰', '🎯', '📈', '🔒', '🌱', '✈️'] as const

export type ProfileIcon = (typeof PROFILE_ICONS)[number]

export const DEFAULT_PROFILE_ICON: ProfileIcon = '🏠'

/** Emoji-only controls have no reliable accessible name, so each option is labelled explicitly. */
export const PROFILE_ICON_LABELS: Record<ProfileIcon, string> = {
	'🏠': 'Home',
	'💼': 'Briefcase',
	'💰': 'Money',
	'🎯': 'Target',
	'📈': 'Chart',
	'🔒': 'Lock',
	'🌱': 'Seedling',
	'✈️': 'Plane',
}

function hashProfileId(profileId: string): number {
	let hash = 0
	for (let i = 0; i < profileId.length; i++) {
		hash = (hash << 5) - hash + profileId.charCodeAt(i)
		hash |= 0
	}
	return Math.abs(hash)
}

export function profileColor(profileId: string): string {
	if (!profileId) return PROFILE_COLORS[0]
	return PROFILE_COLORS[hashProfileId(profileId) % PROFILE_COLORS.length] ?? PROFILE_COLORS[0]
}

export function profileIcon(profileId: string): string {
	if (!profileId) return PROFILE_ICONS[0]
	return PROFILE_ICONS[hashProfileId(profileId) % PROFILE_ICONS.length] ?? PROFILE_ICONS[0]
}

export function isProfileIcon(value: unknown): value is ProfileIcon {
	return typeof value === 'string' && (PROFILE_ICONS as readonly string[]).includes(value)
}

export function resolveProfileIcon(profile: {
	id: string
	icon?: string | null
	isDefault?: boolean
}): string {
	if (isProfileIcon(profile.icon)) return profile.icon
	if (profile.isDefault === true) return DEFAULT_PROFILE_ICON
	return profileIcon(profile.id)
}
