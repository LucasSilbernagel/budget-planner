import type { ClientProfile } from '@/hooks/useActiveProfile'
import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE_FORM, validateProfileForm } from '../profile-form'

/**
 * Shared profile form validator (story 54.1).
 *
 * One rule set for both dialogs. The only difference between them is which
 * profile the name-uniqueness check ignores:
 * - create passes `null` — a new profile has no id, so EVERY existing name counts;
 * - edit passes the id of the profile being edited, so saving under its own name
 *   is allowed.
 *
 * ⚠️ The create dialog used to exclude the ACTIVE profile (`p.id !== activeProfileId`),
 * which let a new profile take the active profile's name. The `null` test below is
 * that bug's regression test.
 */
const profile = (id: string, name: string): ClientProfile => ({
  id,
  userId: 'u1',
  name,
  isDefault: id === 'main',
  currency: 'NONE',
})

const PROFILES = [profile('main', 'Main Profile'), profile('biz', 'Business')]

describe('validateProfileForm (story 54.1)', () => {
  it('requires a name', () => {
    expect(validateProfileForm(EMPTY_PROFILE_FORM, PROFILES, null)['name']).toBe(
      'Profile name is required'
    )
  })

  it('rejects a whitespace-only name', () => {
    expect(validateProfileForm({ name: '   ', description: '' }, PROFILES, null)['name']).toBe(
      'Profile name is required'
    )
  })

  it('accepts a 255-character name and rejects a 256-character one', () => {
    expect(validateProfileForm({ name: 'a'.repeat(255), description: '' }, PROFILES, null)).toEqual(
      {}
    )
    expect(
      validateProfileForm({ name: 'a'.repeat(256), description: '' }, PROFILES, null)['name']
    ).toBe('Profile name must be 255 characters or less')
  })

  it('accepts a 500-character description and rejects a 501-character one', () => {
    expect(
      validateProfileForm({ name: 'New', description: 'd'.repeat(500) }, PROFILES, null)
    ).toEqual({})
    expect(
      validateProfileForm({ name: 'New', description: 'd'.repeat(501) }, PROFILES, null)[
        'description'
      ]
    ).toBe('Description must be 500 characters or less')
  })

  it('lets the profile being edited keep its own name', () => {
    expect(validateProfileForm({ name: 'Business', description: '' }, PROFILES, 'biz')).toEqual({})
  })

  it("rejects another profile's name when the edited profile is NOT the active one", () => {
    // `biz` is not active (the active profile is `main` in every real store seed);
    // the old active-id exclusion would have skipped `main` and let this through.
    expect(
      validateProfileForm({ name: 'Main Profile', description: '' }, PROFILES, 'biz')['name']
    ).toBe('A profile with this name already exists')
  })

  it("create (null exclusion) rejects the ACTIVE profile's name", () => {
    expect(
      validateProfileForm({ name: 'Main Profile', description: '' }, PROFILES, null)['name']
    ).toBe('A profile with this name already exists')
  })

  it('returns no errors for a valid, unique form', () => {
    expect(validateProfileForm({ name: 'Savings', description: '' }, PROFILES, null)).toEqual({})
  })
})
