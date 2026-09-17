import { profileIcon } from '@/lib/profile-appearance'
import { type ClientProfile, useProfileStore } from '@/stores/profileStore'
import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, describe, expect, it } from 'vitest'
import { SwitchProfileDropdown } from '../switch-profile'

/**
 * SwitchProfileDropdown avatars (story 54.2, FR78).
 *
 * ⚠️ WHY THIS FILE IS NEW. `switch-profile.tsx` had NO test of its own, and the
 * one test that renders the page around it — `profiles-page.test.tsx` — mocks it
 * down to `<div data-testid="switch-profile" />`. That blind spot is exactly how
 * the `NaN` avatar bug (`profileId % PROFILE_COLORS.length` against a uuid string)
 * reached production undetected; see `lib/profile-appearance.ts`'s header. An
 * assertion added to `profiles-page.test.tsx` would have been vacuous, so the
 * switcher gets its own render here.
 *
 * ⚠️ `SwitchProfileDropdown` returns `null` when `profiles.length <= 1`, so every
 * test below seeds TWO profiles. With one, the component renders nothing and each
 * assertion would pass or fail for reasons that have nothing to do with icons.
 */

const USER = 'u1'

const main: ClientProfile = {
  id: 'main',
  userId: USER,
  name: 'Main Profile',
  isDefault: true,
  currency: 'NONE',
}

const biz: ClientProfile = {
  id: 'biz',
  userId: USER,
  name: 'Business',
  isDefault: false,
  currency: 'EUR',
}

const seed = (profiles: ClientProfile[]) =>
  useProfileStore.setState({ profiles, activeProfileId: 'main' })

describe('SwitchProfileDropdown avatar icon (story 54.2)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  it('renders at all with two profiles (positive control for the seeding rule)', () => {
    seed([main, biz])
    renderWithProviders(<SwitchProfileDropdown />)

    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
  })

  it("shows the active profile's stored icon on the closed button", () => {
    seed([{ ...main, icon: '✈️' }, biz])
    renderWithProviders(<SwitchProfileDropdown />)

    expect(screen.getByText('✈️')).toBeInTheDocument()
    expect(profileIcon('main')).not.toBe('✈️')
  })

  it('falls back to exactly the hash icon when the active profile has none (AC-8)', () => {
    seed([main, biz])
    renderWithProviders(<SwitchProfileDropdown />)

    expect(screen.getByText(profileIcon('main'))).toBeInTheDocument()
  })

  it('shows each profile its own icon in the open list', async () => {
    const user = userEvent.setup()
    seed([
      { ...main, icon: '✈️' },
      { ...biz, icon: '🎯' },
    ])
    renderWithProviders(<SwitchProfileDropdown />)

    await user.click(screen.getByRole('button', { expanded: false }))

    // The active profile's avatar appears twice once the menu is open (button +
    // its own row), the other exactly once.
    expect(screen.getAllByText('✈️')).toHaveLength(2)
    expect(screen.getAllByText('🎯')).toHaveLength(1)
  })

  it('ignores a stored value that is not one of the eight icons', () => {
    seed([{ ...main, icon: 'not-an-icon' }, biz])
    renderWithProviders(<SwitchProfileDropdown />)

    expect(screen.queryByText('not-an-icon')).toBeNull()
    expect(screen.getByText(profileIcon('main'))).toBeInTheDocument()
  })
})
