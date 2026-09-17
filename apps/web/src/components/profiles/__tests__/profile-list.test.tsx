import { profileIcon } from '@/lib/profile-appearance'
import { useProfileStore } from '@/stores/profileStore'
import { fireEvent, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ProfileList } from '../profile-list'
import { RETIRED_LIGHT_ONLY_TOKENS, collectClassTokens } from './retired-tokens'

/*
 * ⚠️ The `ProfileList currency display (story 8-2)` describe that stood here was
 * deleted by story 54.5 (UX-DR60) along with the card's "Currency:" meta row it
 * probed. Its three tests were the only place `canonicalizeCurrency`'s CAD/AUD ->
 * USD consolidation was asserted through a component — but NOT the only place it
 * is asserted: `packages/core/src/format/__tests__/currency.test.ts:472-476`
 * proves the same mapping directly, so the behaviour is still covered. Only the
 * render path lost coverage, and that render path no longer exists.
 */

/**
 * Edit action (story 54.1, FR77).
 *
 * Every card gets an Edit action — unlike Delete, which is withheld from the
 * default profile and from a single-profile list. Its accessible name carries the
 * profile's name so several cards' Edit buttons are distinguishable.
 *
 * ⚠️ `getByRole`'s `name` is a FULL-STRING match: query the exact label.
 */
describe('ProfileList edit action (story 54.1)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  const main = { id: 'main', userId: 'u1', name: 'Main Profile', isDefault: true, currency: 'NONE' }
  const biz = { id: 'biz', userId: 'u1', name: 'Business', isDefault: false, currency: 'EUR' }

  it('offers Edit on the default profile when it is the only profile', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(screen.getByRole('button', { name: 'Edit Main Profile' })).toBeInTheDocument()
    // Positive control for the visibility rules left untouched: no Delete here.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('offers Edit on both the default and a non-default profile', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(screen.getByRole('button', { name: 'Edit Main Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Business' })).toBeInTheDocument()
  })

  it('opens the Edit Profile dialog for the chosen profile', async () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    const user = userEvent.setup()
    renderWithProviders(<ProfileList />)

    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit Business' }))

    const dialog = screen.getByRole('dialog', { name: 'Edit Profile' })
    expect(within(dialog).getByLabelText(/profile name/i)).toHaveValue('Business')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('re-seeds the dialog when it switches straight to another profile (code review 54.1)', async () => {
    // `Modal` does not inert the background, so another card's Edit button stays
    // reachable while a dialog is open. Without a key the form kept the FIRST
    // profile's values and saved them onto the second.
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    const user = userEvent.setup()
    renderWithProviders(<ProfileList />)

    await user.click(screen.getByRole('button', { name: 'Edit Business' }))
    // Activate the background button directly (a bare click, no pointerdown), as a
    // browser-chrome focus round trip plus Enter can. A pointer gesture would hit
    // the overlay first and close the dialog, which hides the defect.
    const mainEdit = screen
      .getAllByRole('button', { hidden: true })
      .find((b) => b.getAttribute('aria-label') === 'Edit Main Profile')
    if (!mainEdit) throw new Error('Edit Main Profile button not found')
    fireEvent.click(mainEdit)

    const dialog = screen.getByRole('dialog', { name: 'Edit Profile' })
    expect(within(dialog).getByLabelText(/profile name/i)).toHaveValue('Main Profile')
  })
})

/**
 * Story 54.2 (FR78): the card avatar prefers a stored icon.
 *
 * ⚠️ AC-8 is the point of the second test: a profile that has never chosen an icon
 * must render EXACTLY what it rendered before this story, so the column's arrival
 * is invisible to everyone who does not open the picker. Asserting "some emoji is
 * present" would pass even if the fallback had changed, so this compares against
 * `profileIcon` — the hash function, which this story does not touch.
 */
describe('ProfileList avatar icon (story 54.2)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  const main = { id: 'main', userId: 'u1', name: 'Main Profile', isDefault: true, currency: 'NONE' }

  it('renders the stored icon when the profile has one', () => {
    useProfileStore.setState({
      profiles: [{ ...main, icon: '✈️' }],
      activeProfileId: 'main',
    })
    renderWithProviders(<ProfileList />)

    expect(screen.getByText('✈️')).toBeInTheDocument()
    // Discriminating: the hash would NOT have produced this one.
    expect(profileIcon('main')).not.toBe('✈️')
  })

  it('falls back to exactly the hash icon when no icon is stored (AC-8)', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(screen.getByText(profileIcon('main'))).toBeInTheDocument()
  })

  it('ignores a stored value that is not one of the eight icons', () => {
    useProfileStore.setState({
      profiles: [{ ...main, icon: '🦄' }],
      activeProfileId: 'main',
    })
    renderWithProviders(<ProfileList />)

    expect(screen.queryByText('🦄')).toBeNull()
    expect(screen.getByText(profileIcon('main'))).toBeInTheDocument()
  })

  /**
   * Task 6.4's second half, which the code review found ticked but unasserted: a
   * row PULLED from the server with an explicit `icon: null` must render the hash
   * fallback. `applyServerChanges.test.ts` proves the null lands in the store;
   * this proves what the store then renders, which is the half a user sees.
   */
  it('renders the hash fallback for a profile whose stored icon is explicitly null', () => {
    useProfileStore.setState({
      profiles: [{ ...main, icon: null }],
      activeProfileId: 'main',
    })
    renderWithProviders(<ProfileList />)

    expect(screen.getByText(profileIcon('main'))).toBeInTheDocument()
  })
})

/**
 * Story 54.3 (FR80): the card is not a second profile switcher.
 *
 * ⚠️ WHY THESE EXIST AT ALL. Before this story, NO test anywhere in `src` or `e2e`
 * asserted the card's "Switch to" button — so deleting it broke nothing red, and a
 * green suite would have proved nothing about the removal. Absence has to be
 * asserted deliberately or it is not covered.
 *
 * ⚠️ Each absence probe is paired with a positive control in the same test. A
 * `queryByRole` against a card that never rendered returns `null` just as happily
 * as one against a card that rendered without the button — the control proves the
 * query was aimed at a real, rendered card.
 *
 * ⚠️ The probes use `queryByRole('button', { name: /switch/i })`, NOT
 * `queryByText`. `name` accepts a regex, so this catches a relabelled button
 * ("Switch", "Switch profile") as a full-string `'Switch to'` would not — and,
 * unlike a text query, it also catches an icon-only button whose name comes from
 * `aria-label` and has no text node at all. `queryByText` additionally THROWS on
 * multiple matches instead of failing cleanly, so a switcher returning on two
 * cards would error rather than report an assertion failure.
 */
describe('ProfileList has no per-card switcher (story 54.3)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  const main = { id: 'main', userId: 'u1', name: 'Main Profile', isDefault: true, currency: 'NONE' }
  const biz = { id: 'biz', userId: 'u1', name: 'Business', isDefault: false, currency: 'EUR' }

  it('offers no "Switch to" on a NON-ACTIVE card, which is where it used to appear', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    // Positive control, scoped to the card itself: Business is rendered AND is
    // the non-active one — exactly the `!isActive` condition that used to render
    // "Switch to". Asserting "Active Profile" appears *somewhere* would not prove
    // that; an inverted active-card rule would satisfy it just as well.
    // ⚠️ `div.surface`, not `div.bg-white`: story 54.5 moved the card background
    // onto the semantic token, and this selector went red for it. A card locator
    // pinned to a presentational class breaks on any theming change — the throw
    // below is what makes that break loud instead of a silent empty match.
    const bizCard = screen.getByRole('button', { name: 'Edit Business' }).closest('div.surface')
    if (!bizCard) throw new Error('Business card not found')
    expect(within(bizCard).queryByText('Active Profile')).toBeNull()

    const mainCard = screen
      .getByRole('button', { name: 'Edit Main Profile' })
      .closest('div.surface')
    if (!mainCard) throw new Error('Main card not found')
    expect(within(mainCard).getByText('Active Profile')).toBeInTheDocument()

    expect(within(bizCard).queryByRole('button', { name: /switch/i })).toBeNull()
  })

  it('offers no "Switch to" on any card, under either active selection', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'biz' })
    renderWithProviders(<ProfileList />)

    expect(screen.getByRole('button', { name: 'Edit Main Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Business' })).toBeInTheDocument()

    // `queryAllByRole` (not `queryBy`) so a switcher returning on BOTH cards
    // reports an empty-array assertion failure instead of a multiple-match throw.
    expect(screen.queryAllByRole('button', { name: /switch/i })).toHaveLength(0)
  })
})

/**
 * Story 54.5 (UX-DR59, UX-DR60): dark-mode legibility and card declutter.
 *
 * ⚠️ WHY A CLASS SWEEP AND NOT AN E2E TEST. `/profiles` renders this component
 * only for an ACTIVE premium session, and the Playwright preview runtime cannot
 * mint one — `e2e/profiles-premium.spec.ts:10-14` states it outright, and that
 * spec asserts only the locked upgrade surface. `/profiles` is likewise absent
 * from `e2e/theme-page-coverage.spec.ts`'s hand-maintained `PAGES`. So there is
 * no browser-level route to this UI, and the jsdom class assertions below are the
 * automated proof; the rendered two-theme check is manual and recorded in the
 * story's Debug Log.
 *
 * ⚠️ WHAT A TOKEN SWEEP DOES AND DOES NOT PROVE. It proves the class is present,
 * not that it renders the colour — jsdom compiles no Tailwind. Story 54.2's
 * review made exactly this point about a dark-mode test that asserted only colour
 * tokens and would have passed against the defect. The contrast ratios behind
 * these tokens are computed in the story, not here.
 */

describe('ProfileList dark-mode tokens (story 54.5)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  const main = { id: 'main', userId: 'u1', name: 'Main Profile', isDefault: true, currency: 'NONE' }
  const biz = { id: 'biz', userId: 'u1', name: 'Business', isDefault: false, currency: 'EUR' }

  it('gives the "Your Profiles" heading a themed token (AC-1)', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    const { container } = renderWithProviders(<ProfileList />)

    const heading = container.querySelector('h2')
    if (!heading) throw new Error('missing "Your Profiles" heading')
    expect(heading.textContent).toBe('Your Profiles')
    expect([...heading.classList]).toContain('text-heading')
    expect([...heading.classList]).not.toContain('text-gray-900')
  })

  it('puts the card body, divider and actions on semantic tokens (AC-2)', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    const card = screen.getByRole('button', { name: 'Edit Business' }).closest('div.surface')
    if (!card) throw new Error('Business card not found')
    expect([...card.classList]).not.toContain('bg-white')
    // The non-active card's border: themed, not the light-only gray-200.
    expect([...card.classList]).toContain('border-default')

    const edit = screen.getByRole('button', { name: 'Edit Business' })
    expect([...edit.classList]).toContain('text-accent')
    expect([...edit.classList]).not.toContain('text-blue-600')

    // The action-row divider — named in this test's title and, until the code
    // review, never actually asserted here. Only the generic sweep's absence of
    // `border-gray-100` covered it, so a regression to `border-t border-gray-100`
    // left this named test green.
    const divider = card.querySelector('div.border-t')
    if (!divider) throw new Error('action-row divider not found')
    expect([...divider.classList]).toContain('border-default')
    expect([...divider.classList]).not.toContain('border-gray-100')

    const del = screen.getByRole('button', { name: 'Delete' })
    expect([...del.classList]).toContain('dark:text-red-400')

    // ⚠️ VARIANT-PREFIXED PAIRS THE SWEEP CANNOT SEE (code review 54.5). The sweep
    // matches whole tokens, so `hover:text-blue-800` is not a retired token and a
    // MISSING `dark:hover:` twin slips through silently. `pricing-page.test.tsx`
    // records a prior review catching exactly this. Measured consequence if the
    // dark twin goes: Edit's hover becomes blue-800 on gray-800 = 1.68:1 and
    // Delete's becomes red-700 on gray-800 = 2.27:1 — the label vanishes under
    // the pointer, with the whole suite still green.
    expect([...edit.classList]).toContain('dark:hover:text-blue-200')
    expect([...del.classList]).toContain('dark:hover:text-red-300')
    expect([...card.classList]).toContain('dark:hover:border-gray-600')
  })

  it("pairs the active indicator's green with a dark variant (AC-3)", () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    const indicator = screen.getByText('Active Profile').closest('div')
    if (!indicator) throw new Error('active indicator not found')
    expect([...indicator.classList]).toContain('dark:text-green-400')
    // ⚠️ green-700, not the green-600 that stood here: green-600 on white
    // measures 3.30:1, under AA. green-700 measures 5.02:1.
    expect([...indicator.classList]).toContain('text-green-700')
    expect([...indicator.classList]).not.toContain('text-green-600')
  })

  it('leaves no light-only colour token anywhere in the rendered list (AC-2)', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    const { container } = renderWithProviders(<ProfileList />)

    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing ProfileList root')
    // Positive control: the sweep is looking at a real, populated tree, not an
    // empty one that would pass every `not.toContain` for free.
    expect(within(root).getByText('Business')).toBeInTheDocument()

    const classes = collectClassTokens(root)
    // ⚠️ THE CONTROL THAT MAKES THE LOOP BELOW MEAN ANYTHING (code review 54.5).
    // Every assertion in it is a `not.toContain`, so an EMPTY `classes` array
    // passes all 14 for free. Asserting that some text rendered proves the tree is
    // populated; it does NOT prove class collection worked. This does.
    expect(classes.length).toBeGreaterThan(0)
    expect(classes).toContain('surface')

    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
  })

  it('sweeps the single-profile branch too, where the tip box renders (AC-2)', () => {
    // The "💡 Tip" box renders only when there is ONE profile, so the sweep above
    // never sees it. It carried `bg-gray-100` + `text-gray-600`.
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    const { container } = renderWithProviders(<ProfileList />)

    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing ProfileList root')
    expect(within(root).getByText(/Create additional profiles/)).toBeInTheDocument()

    const classes = collectClassTokens(root)
    // ⚠️ THE CONTROL THAT MAKES THE LOOP BELOW MEAN ANYTHING (code review 54.5).
    // Every assertion in it is a `not.toContain`, so an EMPTY `classes` array
    // passes all 14 for free. Asserting that some text rendered proves the tree is
    // populated; it does NOT prove class collection worked. This does.
    expect(classes.length).toBeGreaterThan(0)
    expect(classes).toContain('surface')

    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
  })

  it('sweeps the empty-state branch too (AC-2)', () => {
    // Third branch: no profiles at all. `text-gray-500` lived here.
    useProfileStore.setState({ profiles: [], activeProfileId: null })
    const { container } = renderWithProviders(<ProfileList />)

    const root = container.firstElementChild
    if (!(root instanceof HTMLElement)) throw new Error('missing ProfileList root')
    expect(within(root).getByText('No profiles yet')).toBeInTheDocument()

    const classes = collectClassTokens(root)
    // ⚠️ THE CONTROL THAT MAKES THE LOOP BELOW MEAN ANYTHING (code review 54.5).
    // Every assertion in it is a `not.toContain`, so an EMPTY `classes` array
    // passes all 14 for free. Asserting that some text rendered proves the tree is
    // populated; it does NOT prove class collection worked. This does.
    expect(classes.length).toBeGreaterThan(0)
    // No card in this branch, so anchor on the empty state's own token instead.
    expect(classes).toContain('text-muted')

    for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
      expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
    }
  })
})

/**
 * Story 54.5 (UX-DR60): the card drops its currency and created-at metadata.
 *
 * ⚠️ NOTHING IN THE REPO COVERED "Created:" — a repo-wide grep at `d2f7c20` found
 * it only in the component. "Currency:" was referenced by exactly one test helper
 * (the story 8-2 describe deleted above). So these absence assertions are the
 * only witnesses to the removal, and each is proven red by a mutation arm.
 *
 * ⚠️ Each probe is paired with a positive control in the same test: a
 * `queryByText` against a card that never rendered returns `null` just as happily
 * as one against a card rendered without the row.
 */
describe('ProfileList card metadata removal (story 54.5)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  const main = {
    id: 'main',
    userId: 'u1',
    name: 'Main Profile',
    isDefault: true,
    currency: 'EUR',
    description: 'Everyday spending',
    createdAt: '2026-01-15T10:00:00.000Z',
  }

  it('shows no "Currency:" row (AC-4)', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    // Positive control: the card IS rendered, with the content that survives.
    expect(screen.getByText('Main Profile')).toBeInTheDocument()
    expect(screen.getByText('Everyday spending')).toBeInTheDocument()

    expect(screen.queryByText('Currency:')).toBeNull()
    // The value is gone too, not just its label.
    expect(screen.queryByText('EUR')).toBeNull()
  })

  it('shows no "Created:" row (AC-4)', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(screen.getByRole('button', { name: 'Edit Main Profile' })).toBeInTheDocument()

    expect(screen.queryByText('Created:')).toBeNull()
    // The formatted date `formatDate` used to emit for this `createdAt`.
    expect(screen.queryByText('Jan 15, 2026')).toBeNull()
  })
})
