import { profileIcon } from '@/lib/profile-appearance'
import { type ClientProfile, useProfileStore } from '@/stores/profileStore'
import { renderWithProviders, screen, userEvent, within } from '@/test/utils'
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

/**
 * Story 54.3 (FR80, FR81): this dropdown is the app's ONE profile switcher.
 *
 * ⚠️ The footer's "Manage Profiles →" link pointed at `/profiles`, and this
 * component's only call site is `profiles-page.tsx` — so it was always a
 * same-page no-op. As with the card's "Switch to", NO test asserted it before
 * this story, so its removal had to be covered deliberately.
 *
 * ⚠️ The switch test below belongs HERE and nowhere else. `profiles-page.test.tsx`
 * mocks this component down to `<div data-testid="switch-profile" />`, so any
 * assertion about switching placed there passes without exercising a line of it —
 * the same blind spot that let the `NaN`-avatar bug reach production.
 */
describe('SwitchProfileDropdown is the one switcher (story 54.3)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  it('offers no "Manage Profiles" link to the page it already lives on', async () => {
    const user = userEvent.setup()
    seed([main, biz])
    const { container } = renderWithProviders(<SwitchProfileDropdown />)

    await user.click(screen.getByRole('button', { expanded: false }))

    // Positive control: the menu really is open and populated, so a null probe
    // below means "absent from an open menu", not "the menu never rendered".
    expect(screen.getByText('Switch Profile')).toBeInTheDocument()
    expect(screen.getByText('Business')).toBeInTheDocument()

    expect(screen.queryByRole('link', { name: /manage profiles/i })).toBeNull()
    // Scoped to THIS component's tree, not `document` — a `/profiles` link in an
    // app shell or leaked from another test would otherwise fail it spuriously.
    expect(container.querySelector('a[href="/profiles"]')).toBeNull()
  })

  it('still switches the active profile — the affordance the card no longer duplicates', async () => {
    const user = userEvent.setup()
    seed([main, biz])
    renderWithProviders(<SwitchProfileDropdown />)

    expect(useProfileStore.getState().activeProfileId).toBe('main')

    await user.click(screen.getByRole('button', { expanded: false }))
    const row = screen.getByText('Business').closest('button')
    if (!row) throw new Error('Business row button not found')
    await user.click(row)

    expect(useProfileStore.getState().activeProfileId).toBe('biz')
  })

  /**
   * Code review 54.3 (Edge Case Hunter): an `activeProfileId` that resolves to no
   * profile — a corrupt or stale persisted blob, or an id minted on another
   * device — used to leave NO switcher anywhere. This dropdown bailed on
   * `!activeProfile`, and every card was simultaneously non-active, so before
   * 54.3 the cards' "Switch to" was the escape hatch. 54.3 removed that hatch, so
   * the dropdown must not hide in this state or a free/offline/lapsed user has no
   * way back at all.
   */
  it('still renders a usable switcher when the active id resolves to no profile', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'does-not-exist' })
    renderWithProviders(<SwitchProfileDropdown />)

    // The trigger falls back to the default profile for display...
    const trigger = screen.getByRole('button', { expanded: false })
    expect(within(trigger).getByText('Main Profile')).toBeInTheDocument()

    await user.click(trigger)

    // ...but NO row claims to be active, because none is. The active row is the
    // one carrying `bg-blue-50`; the positive control below proves that marker is
    // real and this probe would see it, so a zero count means "nothing ticked",
    // not "the marker changed name and I found nothing".
    const ticked = () =>
      screen.getAllByRole('button').filter((b) => b.className.includes('bg-blue-50'))
    expect(ticked()).toHaveLength(0)

    // And the state is recoverable: picking a profile writes a real id.
    const row = screen.getByText('Business').closest('button')
    if (!row) throw new Error('Business row button not found')
    await user.click(row)

    expect(useProfileStore.getState().activeProfileId).toBe('biz')

    // Positive control for the `bg-blue-50` probe above: with a VALID active id
    // the marker does appear, so its earlier absence was meaningful.
    await user.click(screen.getByRole('button', { expanded: false }))
    expect(ticked().length).toBeGreaterThan(0)
  })
})
