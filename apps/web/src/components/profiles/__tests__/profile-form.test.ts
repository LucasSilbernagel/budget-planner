// @vitest-environment node
// No DOM needed; the components/** glob would otherwise give it jsdom.
import type { ClientProfile } from '@/hooks/useActiveProfile'
import { describe, expect, it } from 'vitest'
import { EMPTY_PROFILE_FORM, validateProfileForm } from '../profile-form'

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
    expect(
      validateProfileForm({ ...EMPTY_PROFILE_FORM, name: '   ', description: '' }, PROFILES, null)[
        'name'
      ]
    ).toBe('Profile name is required')
  })

  it('accepts a 255-character name and rejects a 256-character one', () => {
    expect(
      validateProfileForm(
        { ...EMPTY_PROFILE_FORM, name: 'a'.repeat(255), description: '' },
        PROFILES,
        null
      )
    ).toEqual({})
    expect(
      validateProfileForm(
        { ...EMPTY_PROFILE_FORM, name: 'a'.repeat(256), description: '' },
        PROFILES,
        null
      )['name']
    ).toBe('Profile name must be 255 characters or less')
  })

  it('accepts a 500-character description and rejects a 501-character one', () => {
    expect(
      validateProfileForm(
        { ...EMPTY_PROFILE_FORM, name: 'New', description: 'd'.repeat(500) },
        PROFILES,
        null
      )
    ).toEqual({})
    expect(
      validateProfileForm(
        { ...EMPTY_PROFILE_FORM, name: 'New', description: 'd'.repeat(501) },
        PROFILES,
        null
      )['description']
    ).toBe('Description must be 500 characters or less')
  })

  it('lets the profile being edited keep its own name', () => {
    expect(
      validateProfileForm(
        { ...EMPTY_PROFILE_FORM, name: 'Business', description: '' },
        PROFILES,
        'biz'
      )
    ).toEqual({})
  })

  it("rejects another profile's name when the edited profile is NOT the active one", () => {
    expect(
      validateProfileForm(
        { ...EMPTY_PROFILE_FORM, name: 'Main Profile', description: '' },
        PROFILES,
        'biz'
      )['name']
    ).toBe('A profile with this name already exists')
  })

  it("create (null exclusion) rejects the ACTIVE profile's name", () => {
    expect(
      validateProfileForm(
        { ...EMPTY_PROFILE_FORM, name: 'Main Profile', description: '' },
        PROFILES,
        null
      )['name']
    ).toBe('A profile with this name already exists')
  })

  it('returns no errors for a valid, unique form', () => {
    expect(
      validateProfileForm(
        { ...EMPTY_PROFILE_FORM, name: 'Savings', description: '' },
        PROFILES,
        null
      )
    ).toEqual({})
  })
})
