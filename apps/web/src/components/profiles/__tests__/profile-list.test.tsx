import { profileIcon } from '@/lib/profile-appearance'
import { useProfileStore } from '@/stores/profileStore'
import { fireEvent, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    // ⚠️ A REGEX since story 63.2, not `{ name: 'Delete' }`. Delete's accessible
    // name now carries the profile name, so the old exact-string probe would
    // pass against a rendered "Delete Main Profile" — a silent green.
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()
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
 * Story 63.1 (FR96): the card IS the switcher.
 *
 * ⚠️⚠️ THIS DESCRIBE REPLACES ONE THAT ASSERTED THE OPPOSITE. Story 54.3 (FR80)
 * removed the per-card "Switch to" affordance and pinned its absence here with
 * two tests (`ProfileList has no per-card switcher`). Those guards did exactly
 * what they were written to do — they made this reversal a deliberate act rather
 * than an accident — and 63.1 deletes them on purpose. FR80's "exactly one
 * control lets a user switch the active profile" clause is still true and still
 * in force; only WHICH control changes. See `epics.md` FR80/FR96.
 *
 * ⚠️ 54.3's probes were `queryByRole('button', { name: /switch/i })` — a regex,
 * chosen so a relabelled or icon-only button could not slip past. That breadth
 * meant they went RED the moment the activation region below was implemented,
 * BEFORE they were deleted. That red was the positive control proving they had
 * been aimed at real rendered cards all along; it is recorded in the story's
 * Debug Log rather than being papered over.
 *
 * ⚠️ WHY A DEDICATED ACTIVATION REGION AND NOT A CLICKABLE CARD. A `<button>`
 * wrapping the card would nest the Edit and Delete `<button>`s inside it, which
 * is invalid HTML and behaves unpredictably. A `<div onClick>` on the card would
 * need `role`, `tabIndex`, a key handler AND `stopPropagation` on both actions —
 * and `stopPropagation` on `onClick` alone does not cover KEYBOARD activation of
 * those actions, which is how that variant ships half-done. The header block is
 * a real `<button>` and Edit/Delete are its SIBLINGS, so there is no nesting and
 * no propagation to stop: the "does not also switch" tests below pass because of
 * the DOM shape, not because of a handler that could regress silently.
 */
describe('ProfileList card is the switcher (story 63.1)', () => {
  /**
   * ⚠️⚠️ WHY THIS CAPTURES AND RESTORES THE ACTION, AND NOT JUST `reset()`.
   * `reset()` (`profileStore.ts:255-263`) restores only the DATA — `profiles`,
   * `activeProfileId`, `isLoading`, `error`. zustand keeps a store's ACTIONS in
   * that same state object, so a test that swaps `switchProfile` for a spy (the
   * AC-3 test below) leaves the spy in place for every test that follows, and
   * `reset()` does not undo it.
   *
   * This was not theoretical: it cost a real debugging cycle. The AC-7 orphan
   * test failed with `expected 'does-not-exist' to be 'biz'` and read exactly
   * like a product defect in the recovery path — the store simply never moved.
   * The switch had in fact been routed to the leaked spy. Restoring the real
   * action here is what makes each test's store genuinely its own.
   */
  const REAL_SWITCH_PROFILE = useProfileStore.getState().switchProfile

  afterEach(() => {
    useProfileStore.setState({ switchProfile: REAL_SWITCH_PROFILE })
    useProfileStore.getState().reset()
  })

  const main = { id: 'main', userId: 'u1', name: 'Main Profile', isDefault: true, currency: 'NONE' }
  const biz = { id: 'biz', userId: 'u1', name: 'Business', isDefault: false, currency: 'EUR' }

  it('switches to a profile when its card is clicked', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(useProfileStore.getState().activeProfileId).toBe('main')

    await user.click(screen.getByRole('button', { name: 'Switch to Business' }))

    expect(useProfileStore.getState().activeProfileId).toBe('biz')
  })

  // ⚠️ Enter and Space are asserted SEPARATELY and explicitly. They come free
  // from the native `<button>`, which is the point — but "it is a button" is the
  // implementation claim, not the requirement. AC-2 asks for keyboard operation,
  // so the test asks the keyboard, and it would catch a later refactor to a
  // `div[role=button]` that forgot its key handler.
  for (const key of ['{Enter}', ' '] as const) {
    it(`switches on keyboard activation (${key === ' ' ? 'Space' : 'Enter'})`, async () => {
      const user = userEvent.setup()
      useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
      renderWithProviders(<ProfileList />)

      screen.getByRole('button', { name: 'Switch to Business' }).focus()
      await user.keyboard(key)

      expect(useProfileStore.getState().activeProfileId).toBe('biz')
    })
  }

  /**
   * ⚠️ These two run against a NON-ACTIVE card on purpose. On the active card a
   * stray switch would be unobservable — the id is already that profile's, so
   * the assertion would hold whether or not the action leaked. Against 'biz'
   * while 'main' is active, a leak CHANGES the store, so the assertion can fail.
   */
  it('opens Edit without also switching to that card', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    await user.click(screen.getByRole('button', { name: 'Edit Business' }))

    // Positive control: the click really did land on Edit.
    expect(screen.getByRole('dialog', { name: 'Edit Profile' })).toBeInTheDocument()
    expect(useProfileStore.getState().activeProfileId).toBe('main')
  })

  it('opens Edit from the KEYBOARD without also switching', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    screen.getByRole('button', { name: 'Edit Business' }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('dialog', { name: 'Edit Profile' })).toBeInTheDocument()
    expect(useProfileStore.getState().activeProfileId).toBe('main')
  })

  it('does not switch when Delete is pressed', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    // 'biz' is non-default and the list has two profiles, so Delete renders.
    const bizCard = screen
      .getByRole('button', { name: 'Switch to Business' })
      .closest('div.surface')
    if (!bizCard) throw new Error('Business card not found')
    await user.click(within(bizCard).getByRole('button', { name: 'Delete Business' }))
    // ⚠️ Story 63.2 put a confirmation in front of the deletion, so the click
    // alone no longer deletes. The test still has to reach a REAL deletion to
    // keep its positive control (below), so it confirms.
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )

    // ⚠️ POSITIVE CONTROL, added by code review (Edge Case Hunter, and MEASURED
    // by them). Without this line the test asserted only that the active id did
    // not move — which holds whether Delete deletes, no-ops, or is unwired. They
    // proved it by replacing `onClick={onDelete}` with `onClick={() => {}}`: the
    // test stayed GREEN. Asserting the deletion really happened is what gives the
    // "…and did not also switch" half something to mean.
    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['main'])
    expect(useProfileStore.getState().activeProfileId).toBe('main')
  })

  // ⚠️ Added by code review. The task list claimed Edit AND Delete were covered
  // "including via keyboard", and only Edit was — the Delete test above uses
  // `user.click`. AC-2 says "clicking", so the AC was met and the CLAIM was not.
  // Writing the missing test was cheaper than defending the gap.
  it('deletes from the KEYBOARD without also switching', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    const bizCard = screen
      .getByRole('button', { name: 'Switch to Business' })
      .closest('div.surface')
    if (!bizCard) throw new Error('Business card not found')
    within(bizCard).getByRole('button', { name: 'Delete Business' }).focus()
    await user.keyboard('{Enter}')
    // Story 63.2: confirm from the keyboard too, so this stays a real deletion.
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }).focus()
    await user.keyboard('{Enter}')

    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['main'])
    expect(useProfileStore.getState().activeProfileId).toBe('main')
  })

  /**
   * AC-3: the ACTIVE card does not present itself as activatable.
   *
   * ⚠️ THE SAME-OUTCOME TRAP. "Clicking the active card leaves it active" is an
   * outcome the CORRECT code and a broken no-op both produce — the id is already
   * 'main', so a store assertion here cannot fail. So the MECHANISM is asserted
   * instead: `switchProfile` is swapped for a spy in the store's own state (the
   * actions live there alongside the data, and `useProfileSwitcher` reads them at
   * render), and the test proves it was never called. Compare the positive
   * control at the end, which proves the spy is wired and CAN record a call.
   */
  it('does not present the active card as activatable to itself', async () => {
    const user = userEvent.setup()
    const switchProfile = vi.fn()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main', switchProfile })
    renderWithProviders(<ProfileList />)

    const activeRegion = screen.getByRole('button', { name: 'Main Profile (current profile)' })
    expect(activeRegion).toHaveAttribute('aria-current', 'true')
    expect(activeRegion).toHaveAttribute('aria-disabled', 'true')

    await user.click(activeRegion)
    expect(switchProfile).not.toHaveBeenCalled()

    // Positive control: the spy is real and records a genuine switch, so its
    // silence above means "not called", not "never wired up".
    await user.click(screen.getByRole('button', { name: 'Switch to Business' }))
    expect(switchProfile).toHaveBeenCalledWith('biz')
  })

  // ⚠️ `aria-disabled`, NOT `disabled`. A `disabled` button is removed from the
  // tab order, and the active profile's NAME lives inside this region — so
  // `disabled` would make the one card a keyboard user most wants to confirm the
  // only one they cannot reach. `aria-disabled` keeps it focusable and readable
  // while announcing that there is nothing to activate.
  it('keeps the active card focusable so its name is still reachable', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    const activeRegion = screen.getByRole('button', { name: 'Main Profile (current profile)' })
    activeRegion.focus()
    expect(activeRegion).toHaveFocus()
  })

  /**
   * AC-7 — the escape hatch that 54.3's code review (Edge Case Hunter) found,
   * re-homed onto the cards.
   *
   * ⚠️⚠️ WHY THIS TEST MOVED RATHER THAN DIED. An `activeProfileId` that resolves
   * to NO profile — a corrupt or stale persisted blob, or an id minted on another
   * device — used to leave a user with no switcher at all. `switch-profile.tsx`
   * carried a deliberate guard against it (never hide the only switcher; fall
   * back to the default for DISPLAY only) and `switch-profile.test.tsx` pinned
   * it. 63.1 deletes both. Card-as-switcher very likely fixes the case for free,
   * because every card is a control and there is no `!activeProfile` bail-out to
   * hide behind — but "likely" is not a test, and deleting the file without
   * re-homing the case would quietly re-open a defect a review already caught.
   */
  it('stays usable and recoverable when the active id resolves to no profile', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'does-not-exist' })
    renderWithProviders(<ProfileList />)

    // Nothing claims to be active, because nothing is.
    expect(screen.queryByText('Active Profile')).toBeNull()
    expect(screen.queryByRole('button', { name: /\(current profile\)$/ })).toBeNull()

    // Every card is still an offered way back.
    expect(screen.getByRole('button', { name: 'Switch to Main Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Business' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch to Business' }))
    expect(useProfileStore.getState().activeProfileId).toBe('biz')

    // Positive control for the two absence probes above: with a VALID active id
    // the "Active Profile" marker and the current-profile region DO appear, so
    // their earlier absence meant "nothing ticked", not "I misnamed the probe".
    expect(screen.getByText('Active Profile')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Business (current profile)' })).toBeInTheDocument()
  })

  /**
   * ⚠️⚠️ THE CARD'S CONTENT STAYS IN THE ACCESSIBILITY TREE (code review).
   *
   * The first implementation of this story made the whole card header one
   * `<button aria-label=…>`. ARIA's `button` role is CHILDREN-PRESENTATIONAL:
   * every descendant's role is stripped. So the `<h3>` disappeared from heading
   * navigation, and the "Default" badge and the description were announced
   * NOWHERE — they exist on no other surface. TWO independent review layers
   * found it; no automated check could, because testing-library does not model
   * presentational children and Playwright's snapshot did not either.
   *
   * The fix was structural: only the NAME is the button now, and the heading,
   * badge and description are content again. These tests are the guard, and they
   * assert the things that were LOST — a heading role, and text outside the
   * control — rather than merely that the strings appear somewhere, which was
   * true of the broken version too.
   */
  it('keeps the profile name a real level-3 heading', () => {
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(screen.getByRole('heading', { level: 3, name: 'Business' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Main Profile' })).toBeInTheDocument()
  })

  it('keeps the description and the Default badge OUTSIDE the activation control', () => {
    useProfileStore.setState({
      profiles: [{ ...main, description: 'Everyday money' }, biz],
      activeProfileId: 'main',
    })
    renderWithProviders(<ProfileList />)

    const control = screen.getByRole('button', { name: 'Main Profile (current profile)' })

    const description = screen.getByText('Everyday money')
    expect(description).toBeInTheDocument()
    // ⚠️ The discriminating assertion. In the broken version this text WAS in the
    // document — it was simply inside the button, where ARIA hides it. Asserting
    // presence alone would have passed against the defect.
    expect(control.contains(description)).toBe(false)

    const badge = screen.getByText('Default')
    expect(control.contains(badge)).toBe(false)
  })

  // ⚠️ `SwitchProfileDropdown` returned `null` below two profiles, so a
  // single-profile user saw no switcher at all. The card list has no such floor.
  // This pins that the lone card reads as the current profile rather than
  // inheriting the deleted component's hidden-control assumption.
  it('presents a lone profile as current, not as something to switch to', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    expect(
      screen.getByRole('button', { name: 'Main Profile (current profile)' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Switch to / })).toBeNull()
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

    const del = screen.getByRole('button', { name: 'Delete Business' })
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

/**
 * Story 63.2 (FR97): every deletion is confirmed, and the default profile is
 * deletable once another profile exists.
 *
 * ⚠️⚠️ WHERE DELETION IS ACTUALLY ENFORCED, because the epic says otherwise.
 * `server/functions/profiles.ts:deleteProfile` has ZERO production callers — the
 * live path is this component -> `useProfileManager().deleteProfile` ->
 * `profileStore.removeProfile` -> `syncEntityDelete` -> the sync push. The store
 * is where the default guard lived and where it is lifted; the store-level
 * consequences (promotion, tombstone ordering) are proven in
 * `stores/__tests__/profile-deletion.dom.test.ts`, not here.
 *
 * ⚠️ Delete's accessible name now carries the profile name (`Delete Business`),
 * matching Edit. It has to: the default card gained a Delete button, so a bare
 * "Delete" is ambiguous to a screen-reader user AND to `getByRole`. Because
 * `name` is a FULL-STRING match, every absence probe in this file was rewritten
 * to `/^Delete /` rather than `'Delete'` — a probe for the old exact string would
 * now pass for the wrong reason, which is the silent-green trap recorded in
 * `budget-planner-icon-only-button-naming`.
 */
describe('ProfileList delete confirmation (story 63.2)', () => {
  /**
   * ⚠️ `reset()` restores DATA only; zustand keeps actions in the same state
   * object, so a spied `removeProfile` would leak into every later test. Same
   * hazard 63.1 hit with `switchProfile`, and it cost a real debugging cycle.
   */
  const REAL_REMOVE_PROFILE = useProfileStore.getState().removeProfile

  afterEach(() => {
    useProfileStore.setState({ removeProfile: REAL_REMOVE_PROFILE })
    useProfileStore.getState().reset()
  })

  const main = {
    id: 'main',
    userId: 'u1',
    name: 'Main Profile',
    isDefault: true,
    currency: 'NONE',
  }
  const biz = { id: 'biz', userId: 'u1', name: 'Business', isDefault: false, currency: 'EUR' }

  it('asks first, and deletes nothing while the dialog is open', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    await user.click(screen.getByRole('button', { name: 'Delete Business' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    // The profile is still there: opening the dialog is not the deletion.
    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['main', 'biz'])
  })

  it('deletes once Confirm is pressed', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    await user.click(screen.getByRole('button', { name: 'Delete Business' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )

    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['main'])
  })

  /**
   * ⚠️⚠️ THE MECHANISM, NOT THE OUTCOME. "The profile is still listed" is an
   * outcome the CORRECT code and a broken path both produce — a Cancel that
   * called through to a `removeProfile` which then refused for an unrelated
   * reason (last profile, missing id) leaves exactly the same list. That is the
   * same-outcome vacuity mode mutation N3 found in 62.2. So the store ACTION is
   * spied and proven un-called, with a positive control that it can record one.
   */
  for (const [label, dismiss] of [
    [
      'Cancel',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
        )
      },
    ],
    [
      'Escape',
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.keyboard('{Escape}')
      },
    ],
    // ⚠️ The backdrop arm was missing until the code review: AC-1 names Cancel,
    // Escape AND a backdrop click, and only the first two were exercised.
    // `Modal` routes an overlay click to `onClose` -> `onCancel`; inheriting the
    // behaviour is not the same as pinning it.
    [
      'a backdrop click',
      async (user: ReturnType<typeof userEvent.setup>) => {
        const overlay = screen.getByRole('alertdialog').parentElement
        if (!overlay) throw new Error('modal overlay not found')
        await user.click(overlay)
      },
    ],
  ] as const) {
    it(`deletes NOTHING when the dialog is dismissed with ${label}`, async () => {
      const user = userEvent.setup()
      const removeProfile = vi.fn()
      useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main', removeProfile })
      renderWithProviders(<ProfileList />)

      await user.click(screen.getByRole('button', { name: 'Delete Business' }))
      await dismiss(user)

      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(removeProfile).not.toHaveBeenCalled()

      // Positive control: the spy is wired and DOES record a real confirm, so its
      // silence above means "not called", not "never reachable".
      await user.click(screen.getByRole('button', { name: 'Delete Business' }))
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
      )
      expect(removeProfile).toHaveBeenCalledWith('biz')
    })
  }

  it('names the profile and states what is lost', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    await user.click(screen.getByRole('button', { name: 'Delete Business' }))

    const dialog = screen.getByRole('alertdialog')
    // The name is the whole point: a profile carries an entire financial data
    // set, and "are you sure?" alone does not say WHICH one is about to go.
    expect(dialog.textContent).toContain('Business')
    expect(dialog.textContent).toMatch(/can(no|')t be undone|cannot be undone/i)
  })

  it('offers Delete on the DEFAULT profile once another profile exists (AC-2)', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'biz' })
    renderWithProviders(<ProfileList />)

    // The reversal: before 63.2 this button was withheld from the default card,
    // and `profile-list.test.tsx:41` pinned its absence.
    await user.click(screen.getByRole('button', { name: 'Delete Main Profile' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )

    const state = useProfileStore.getState()
    expect(state.profiles.map((p) => p.id)).toEqual(['biz'])
    // …and the survivor inherits the flag, so the account is never default-less.
    expect(state.profiles.find((p) => p.isDefault)?.id).toBe('biz')
  })

  /**
   * ⚠️⚠️ FOCUS RETURN, BOTH BRANCHES — and this test exists because reasoning
   * about it produced the WRONG fix first (code review).
   *
   * `Modal` restores with `finalFocusRef?.current ?? previouslyFocused` inside an
   * effect CLEANUP, which closes over the props from the render where the effect
   * last ran — the render that OPENED the dialog. So a `finalFocusRef` passed
   * conditionally at close time is never seen. What IS read at cleanup time is
   * `.current`, so the component passes one stable ref and mutates it.
   *
   * The two branches genuinely differ: on dismissal the Delete button is still
   * mounted and is where the user was, so focus must go back to it; on confirm
   * that button unmounts with its card and the default target would be detached.
   */
  it('returns focus to the Delete button when the dialog is dismissed', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    const trigger = screen.getByRole('button', { name: 'Delete Business' })
    await user.click(trigger)
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    )

    expect(trigger).toHaveFocus()
  })

  it('moves focus to the heading when the confirm removes the card', async () => {
    const user = userEvent.setup()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)

    await user.click(screen.getByRole('button', { name: 'Delete Business' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    )

    // Not merely "not body": the heading specifically, because that is the
    // element `finalFocusRef` names.
    expect(screen.getByRole('heading', { name: 'Your Profiles' })).toHaveFocus()
  })

  it('still withholds Delete from a lone profile (AC-4, unchanged)', () => {
    useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
    const { unmount } = renderWithProviders(<ProfileList />)

    // ⚠️ A regex, not `{ name: 'Delete' }`: the labels now carry profile names,
    // so the old exact-string probe would pass without proving anything.
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()

    // ⚠️ POSITIVE CONTROL for the probe itself. An absence assertion is only
    // worth what its query is worth, and this one is a regex written in the same
    // pass that renamed the buttons — so prove the regex CAN match before
    // trusting that it found nothing.
    unmount()
    useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
    renderWithProviders(<ProfileList />)
    expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(2)
  })
})
