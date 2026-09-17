import { profileIcon } from '@/lib/profile-appearance'
import { type ClientProfile, useProfileStore } from '@/stores/profileStore'
import { renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { afterEach, describe, expect, it } from 'vitest'
import { SwitchProfileDropdown } from '../switch-profile'
import { RETIRED_LIGHT_ONLY_TOKENS, collectClassTokens } from './retired-tokens'

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

/**
 * Story 54.5 (UX-DR59): the switcher is legible in dark mode.
 *
 * ⚠️ THE MENU IS GATED ON `isOpen`. Only FOUR of this story's changed class sites
 * live on the always-rendered trigger (the button, the current-profile name, the
 * profile count and the chevron); every other one is inside that branch and does
 * not exist in the DOM until the dropdown is opened. A sweep of the CLOSED
 * component therefore skips most of them and reports a confident green, so every
 * sweep below opens it first.
 *
 * (An earlier version of this comment claimed "eleven of the twelve", which was
 * simply wrong — the code review counted it. The gate argument is unaffected; the
 * number was not.)
 *
 * ⚠️ `SwitchProfileDropdown` returns `null` below two profiles — seed two.
 *
 * ⚠️ A token sweep proves the class is present, not that it renders the colour;
 * jsdom compiles no Tailwind. The contrast ratios behind these tokens are
 * computed in the story. There is no e2e counterpart because the preview runtime
 * cannot mint a premium session (`e2e/profiles-premium.spec.ts:10-14`).
 */

describe('SwitchProfileDropdown dark-mode tokens (story 54.5)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  it('puts the closed trigger on semantic tokens', () => {
    seed([main, biz])
    renderWithProviders(<SwitchProfileDropdown />)

    const trigger = screen.getByRole('button', { expanded: false })
    expect([...trigger.classList]).toContain('surface')
    expect([...trigger.classList]).toContain('border-default')
    expect([...trigger.classList]).not.toContain('bg-white')
    expect([...trigger.classList]).not.toContain('border-gray-300')
    // ⚠️ `gray-700/50`, not solid `gray-700` (code review 54.5): this button
    // carries the "N profiles" count in `text-muted` (gray-400 in dark), and
    // gray-400 on solid gray-700 is 4.06:1 — under AA, and only while hovered, so
    // no resting-state check sees it. The /50 blend measures 4.88:1.
    expect([...trigger.classList]).toContain('dark:hover:bg-gray-700/50')
    expect([...trigger.classList]).not.toContain('dark:hover:bg-gray-700')
  })

  it('puts the OPEN menu panel and its header on semantic tokens', async () => {
    seed([main, biz])
    const user = userEvent.setup()
    renderWithProviders(<SwitchProfileDropdown />)

    await user.click(screen.getByRole('button', { expanded: false }))

    const header = screen.getByText('Switch Profile')
    expect([...header.classList]).toContain('text-label')

    const panel = header.closest('div.absolute')
    if (!panel) throw new Error('open menu panel not found')
    expect([...panel.classList]).toContain('surface')
    expect([...panel.classList]).toContain('border-default')
    expect([...panel.classList]).not.toContain('bg-white')
  })

  it('keeps the active-row tint but pairs it with a dark variant', async () => {
    seed([main, biz])
    const user = userEvent.setup()
    renderWithProviders(<SwitchProfileDropdown />)

    await user.click(screen.getByRole('button', { expanded: false }))

    const activeRow = screen.getByText('Main Profile', { selector: 'p' }).closest('button')
    if (!activeRow) throw new Error('active row not found')
    // `bg-blue-50` is deliberately retained: `switch-profile.test.tsx`'s 54.3
    // orphaned-id test locates the ticked row by that exact token.
    expect([...activeRow.classList]).toContain('bg-blue-50')
    expect([...activeRow.classList]).toContain('dark:bg-blue-950/40')
    expect([...activeRow.classList]).toContain('dark:hover:bg-gray-700')
  })

  it('uses text-body, not text-muted, for a row description (AC-3)', async () => {
    // ⚠️ Not cosmetic parity with the card. A row can sit on the `bg-blue-50`
    // active tint, where `text-muted`'s light value (gray-500) measures 4.44:1 —
    // under AA. gray-600 measures 6.94:1 there and 7.56:1 on an untinted row.
    seed([main, biz])
    const user = userEvent.setup()
    renderWithProviders(<SwitchProfileDropdown />)

    await user.click(screen.getByRole('button', { expanded: false }))

    // Both fixtures are description-less, so both rows render this placeholder —
    // assert on every one of them, which also covers the active and non-active
    // row in the same pass.
    const descriptions = screen.getAllByText('No description', { selector: 'p' })
    expect(descriptions).toHaveLength(2)
    for (const description of descriptions) {
      expect([...description.classList]).toContain('text-body')
      expect([...description.classList]).not.toContain('text-muted')
      expect([...description.classList]).not.toContain('text-gray-500')
    }
  })

  it('leaves no light-only colour token anywhere in the OPEN dropdown', async () => {
    seed([main, biz])
    const user = userEvent.setup()
    const { container } = renderWithProviders(<SwitchProfileDropdown />)

    await user.click(screen.getByRole('button', { expanded: false }))

    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing dropdown root')
    // Positive control: the menu really is open, so the sweep is looking at the
    // gated subtree and not at a closed trigger that passes every probe for free.
    expect(within(root).getByText('Switch Profile')).toBeInTheDocument()
    expect(within(root).getByText('Business', { selector: 'p' })).toBeInTheDocument()

    const classes = collectClassTokens(root)
    // ⚠️ The control that makes the loop below mean anything (code review 54.5):
    // every assertion in it is a `not.toContain`, which an EMPTY array satisfies.
    expect(classes.length).toBeGreaterThan(0)
    expect(classes).toContain('surface')

    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
  })

  it('leaves no light-only colour token on the CLOSED trigger either', () => {
    seed([main, biz])
    const { container } = renderWithProviders(<SwitchProfileDropdown />)

    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing dropdown root')
    expect(within(root).getByRole('button', { expanded: false })).toBeInTheDocument()

    const classes = collectClassTokens(root)
    // ⚠️ The control that makes the loop below mean anything (code review 54.5):
    // every assertion in it is a `not.toContain`, which an EMPTY array satisfies.
    expect(classes.length).toBeGreaterThan(0)
    expect(classes).toContain('surface')

    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
  })
})
