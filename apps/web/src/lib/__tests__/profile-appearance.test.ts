import { describe, expect, it } from 'vitest'
import { profileColor, profileIcon } from '../profile-appearance'

/**
 * Avatar colour/icon derivation (regression pin).
 *
 * ⚠️ WHY THIS FILE EXISTS. `profiles/switch-profile.tsx` typed a profile id as
 * `number` and derived its avatar with `profileId % PROFILE_COLORS.length`. Ids
 * have been uuid STRINGS since story 5-14, so that expression evaluated to `NaN`,
 * the lookup returned `undefined`, and every avatar in the profile switcher
 * rendered with no colour class and no emoji — on a component mounted at
 * `routes/profiles.tsx:81`. Nothing failed, because
 * `routes/__tests__/profiles.test.tsx:40` mocks `SwitchProfileDropdown` out.
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
