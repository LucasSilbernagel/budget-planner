import { describe, expect, it } from 'vitest'
import {
  PROFILE_ICONS,
  isProfileIcon,
  profileColor,
  profileIcon,
  resolveProfileIcon,
} from '../profile-appearance'

/**
 * Avatar colour/icon derivation (regression pin).
 *
 * ⚠️ WHY THIS FILE EXISTS. `profiles/switch-profile.tsx` typed a profile id as
 * `number` and derived its avatar with `profileId % PROFILE_COLORS.length`. Ids
 * have been uuid STRINGS since story 5-14, so that expression evaluated to `NaN`,
 * the lookup returned `undefined`, and every avatar in the profile switcher
 * rendered with no colour class and no emoji. Nothing failed, because
 * `components/profiles/__tests__/profiles-page.test.tsx` mocked `SwitchProfileDropdown` out.
 *
 * ⚠️ That component was DELETED by story 63.1 (FR96) — the profile cards are the
 * switcher now — so the defect site above is history. These assertions are not:
 * they pin the derivation itself, which `profile-list.tsx` still uses and which a
 * future second avatar surface would have to match.
 *
 * A DOM test of the switcher would not have caught it either: the broken value
 * was `undefined`, which React simply omits from `className`, so the element
 * still rendered. What catches it is asserting on the derivation itself.
 */

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const OTHER_UUID = '9c858901-8a57-4791-81fe-4c455b099bc9'

describe('profileColor / profileIcon', () => {
  it('returns a real Tailwind class for a uuid, never undefined', () => {
    // The exact assertion the modulo bug failed: `"uuid" % 8` -> NaN -> undefined.
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
    // Not a guarantee for every pair (8 buckets), but these two must differ or the
    // hash is not spreading at all.
    const pair = `${profileColor(UUID)}|${profileIcon(UUID)}`
    const other = `${profileColor(OTHER_UUID)}|${profileIcon(OTHER_UUID)}`
    expect(pair).not.toBe(other)
  })

  it('falls back rather than returning undefined for an empty id', () => {
    expect(profileColor('')).toMatch(/^bg-\w+-500$/)
    expect(profileIcon('')).not.toBe('')
  })
})

/**
 * Story 54.2 (FR78): a profile may now STORE a chosen icon, which wins over the
 * hash.
 *
 * ⚠️ The hash itself is unchanged and must stay unchanged — it is what every
 * profile that has never had an icon chosen still renders, on every device. The
 * literal pins below exist so that a future edit to `hashProfileId` or to the
 * order of `PROFILE_ICONS` goes RED here rather than silently reshuffling every
 * existing user's avatars.
 */
describe('resolveProfileIcon (story 54.2)', () => {
  // ⚠️ These ARE computed via `profileIcon` — an earlier comment here claimed the
  // opposite and was wrong (code review 54.2). Using them alone would only prove
  // that `resolveProfileIcon` DELEGATES to `profileIcon`, not that either returns
  // the right emoji. The actual pin is the literal assertion in the next test; if
  // that test is ever deleted or skipped, everything below becomes tautological.
  const UUID_HASH_ICON = profileIcon(UUID)
  const OTHER_HASH_ICON = profileIcon(OTHER_UUID)

  it('exposes exactly the eight fixed icons', () => {
    expect(PROFILE_ICONS).toEqual(['🏠', '💼', '💰', '🎯', '📈', '🔒', '🌱', '✈️'])
  })

  it('pins the hash output, so a hash change cannot silently reshuffle avatars', () => {
    // If these two literals ever need updating, every existing profile's avatar
    // has changed. That is a product decision, not a refactor.
    expect(UUID_HASH_ICON).toBe('🔒')
    expect(OTHER_HASH_ICON).toBe('🌱')
  })

  it('prefers a stored icon over the hash', () => {
    expect(resolveProfileIcon({ id: UUID, icon: '✈️' })).toBe('✈️')
    // Discriminating: the stored value is NOT what the hash would have produced.
    expect(resolveProfileIcon({ id: UUID, icon: '✈️' })).not.toBe(UUID_HASH_ICON)
  })

  it('falls back to the hash when no icon is stored', () => {
    expect(resolveProfileIcon({ id: UUID })).toBe(UUID_HASH_ICON)
    expect(resolveProfileIcon({ id: UUID, icon: null })).toBe(UUID_HASH_ICON)
    expect(resolveProfileIcon({ id: UUID, icon: undefined })).toBe(UUID_HASH_ICON)
  })

  /**
   * The `icon` column has no CHECK constraint — none is declared for it, and
   * story 66.5 added no new declarations when it landed the eight that were. So a
   * row written by a future or misbehaving client can hold any string, and the
   * render boundary is the real enforcement.
   */
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

describe('isProfileIcon (story 54.2)', () => {
  it.each([...PROFILE_ICONS])('accepts the fixed icon %s', (icon) => {
    expect(isProfileIcon(icon)).toBe(true)
  })

  it.each(['🦄', 'not-an-icon', '', null, undefined, 0, {}, []])('rejects %s', (bad) => {
    expect(isProfileIcon(bad)).toBe(false)
  })
})
