import { describe, expect, it } from 'vitest'
import {
	DEFAULT_PROFILE_ICON,
	isProfileIcon,
	PROFILE_ICONS,
	profileColor,
	profileIcon,
	resolveProfileIcon,
} from '../profile-appearance'

/**
 * Ids are uuid strings; a numeric modulo yields NaN and an undefined class, which React
 * silently omits, so the derivation itself is what must be asserted.
 */

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const OTHER_UUID = '9c858901-8a57-4791-81fe-4c455b099bc9'

describe('profileColor / profileIcon', () => {
	it('returns a real Tailwind class for a uuid, never undefined', () => {
		expect(profileColor(UUID)).toMatch(/^bg-\w+-500$/)
	})

	it('returns a real emoji for a uuid, never undefined', () => {
		expect(profileIcon(UUID)).not.toBe('')
		expect(typeof profileIcon(UUID)).toBe('string')
	})

	it('is stable across calls — an avatar must not change between renders', () => {
		expect(profileColor(UUID)).toBe(profileColor(UUID))
		expect(profileIcon(UUID)).toBe(profileIcon(UUID))
	})

	it('distinguishes different ids', () => {
		const pair = `${profileColor(UUID)}|${profileIcon(UUID)}`
		const other = `${profileColor(OTHER_UUID)}|${profileIcon(OTHER_UUID)}`
		expect(pair).not.toBe(other)
	})

	it('falls back rather than returning undefined for an empty id', () => {
		expect(profileColor('')).toMatch(/^bg-\w+-500$/)
		expect(profileIcon('')).not.toBe('')
	})
})

/** Literal pins: changing `hashProfileId` or the order of `PROFILE_ICONS` reshuffles every existing avatar. */
describe('resolveProfileIcon', () => {
	const UUID_HASH_ICON = profileIcon(UUID)
	const OTHER_HASH_ICON = profileIcon(OTHER_UUID)

	it('exposes exactly the eight fixed icons', () => {
		expect(PROFILE_ICONS).toEqual(['🏠', '💼', '💰', '🎯', '📈', '🔒', '🌱', '✈️'])
	})

	it('pins the hash output, so a hash change cannot silently reshuffle avatars', () => {
		expect(UUID_HASH_ICON).toBe('🔒')
		expect(OTHER_HASH_ICON).toBe('🌱')
	})

	it('prefers a stored icon over the hash', () => {
		expect(resolveProfileIcon({ id: UUID, icon: '✈️' })).toBe('✈️')
		expect(resolveProfileIcon({ id: UUID, icon: '✈️' })).not.toBe(UUID_HASH_ICON)
	})

	it('falls back to the hash when no icon is stored', () => {
		expect(resolveProfileIcon({ id: UUID })).toBe(UUID_HASH_ICON)
		expect(resolveProfileIcon({ id: UUID, icon: null })).toBe(UUID_HASH_ICON)
		expect(resolveProfileIcon({ id: UUID, icon: undefined })).toBe(UUID_HASH_ICON)
	})

	/** The `icon` column has no CHECK constraint, so the render boundary is the real enforcement. */
	it.each(['🦄', 'not-an-icon', '', '<script>alert(1)</script>'])(
		'falls back to the hash for a non-member stored value (%s)',
		(bad) => {
			expect(resolveProfileIcon({ id: UUID, icon: bad })).toBe(UUID_HASH_ICON)
		}
	)

	it('is stable across calls for the same input', () => {
		expect(resolveProfileIcon({ id: UUID, icon: '🎯' })).toBe(
			resolveProfileIcon({ id: UUID, icon: '🎯' })
		)
	})
})

describe('resolveProfileIcon: 🏠 for the default profile', () => {
	const UUID_HASH_ICON = profileIcon(UUID)

	it('exports 🏠 as the default-profile icon, a member of the fixed set', () => {
		expect(DEFAULT_PROFILE_ICON).toBe('🏠')
		expect(isProfileIcon(DEFAULT_PROFILE_ICON)).toBe(true)
	})

	it('renders 🏠 for the default profile with no stored icon', () => {
		// Discriminating: this uuid hashes to 🔒, not 🏠 (pinned above).
		expect(UUID_HASH_ICON).not.toBe('🏠')
		expect(resolveProfileIcon({ id: UUID, isDefault: true })).toBe('🏠')
		expect(resolveProfileIcon({ id: UUID, icon: null, isDefault: true })).toBe('🏠')
		expect(resolveProfileIcon({ id: UUID, icon: undefined, isDefault: true })).toBe('🏠')
	})

	it('lets a stored valid icon win over 🏠 on the default profile', () => {
		expect(resolveProfileIcon({ id: UUID, icon: '✈️', isDefault: true })).toBe('✈️')
	})

	it.each(['', 'x', '🦄'])(
		'renders 🏠 for the default profile holding an invalid icon (%s)',
		(bad) => {
			expect(resolveProfileIcon({ id: UUID, icon: bad, isDefault: true })).toBe('🏠')
		}
	)

	it('keeps the hash fallback for a NON-default profile with no stored icon', () => {
		expect(resolveProfileIcon({ id: UUID, icon: null, isDefault: false })).toBe(UUID_HASH_ICON)
		expect(resolveProfileIcon({ id: UUID, icon: null, isDefault: false })).toBe('🔒')
	})

	it('keeps the hash fallback when isDefault is absent', () => {
		expect(resolveProfileIcon({ id: UUID, icon: null })).toBe('🔒')
	})
})

describe('isProfileIcon', () => {
	it.each([...PROFILE_ICONS])('accepts the fixed icon %s', (icon) => {
		expect(isProfileIcon(icon)).toBe(true)
	})

	it.each(['🦄', 'not-an-icon', '', null, undefined, 0, {}, []])('rejects %s', (bad) => {
		expect(isProfileIcon(bad)).toBe(false)
	})
})
