import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useBalanceStore } from '../../stores/balanceStore'
import { useProfileStore } from '../../stores/profileStore'
import { BalancePage } from '../BalancePage'
import { CreateProfileDialog } from '../profiles/create-profile'
import { EditProfileDialog } from '../profiles/edit-profile'

/**
 * Story 11-2 (AC-3): the modals that override `Modal`'s default className —
 * `create-profile`, `edit-profile` (added by story 54.1) and the `BalancePage`
 * add/edit modal — must supply their own dark surface, because overriding the
 * default drops the `dark:bg-gray-800` Modal now ships. That stays true after story 31.3: `className` still fully
 * replaces the VISUAL default; only the layout constant
 * (`MODAL_CARD_CONSTRAINT`) is applied additively on top.
 * 7-3's review deferred the first and last of these (a light card
 * floating on the dark canvas for a user in dark mode); this guards them
 * from regressing. jsdom can't compute Tailwind, so we assert the `dark:` class
 * that drives the dark surface is present on the dialog card.
 */
describe('override-modal dark surfaces (story 11-2, AC-3)', () => {
  beforeEach(() => {
    useBalanceStore.setState({ entries: [] })
  })

  afterEach(() => {
    useProfileStore.getState().reset()
  })

  it('gives the create-profile modal card a dark surface', () => {
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('dark:bg-gray-800')
  })

  it('gives the edit-profile modal card a dark surface (story 54.1)', () => {
    useProfileStore.setState({
      profiles: [{ id: 'p1', userId: 'u1', name: 'Main', isDefault: true, currency: 'NONE' }],
      activeProfileId: 'p1',
    })
    renderWithProviders(<EditProfileDialog profileId="p1" onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('dark:bg-gray-800')
  })

  /**
   * Story 54.2: the icon picker sits inside that dark card, so BOTH of its states
   * need a dark variant — an unselected option with only a light `border-gray-300`
   * is invisible against `dark:bg-gray-800`.
   */
  it('gives both icon-picker states a dark variant (story 54.2)', () => {
    useProfileStore.setState({
      profiles: [{ id: 'p1', userId: 'u1', name: 'Main', isDefault: true, currency: 'NONE' }],
      activeProfileId: 'p1',
    })
    renderWithProviders(<EditProfileDialog profileId="p1" onClose={() => {}} />)

    const options = screen.getAllByRole('radio')
    const selected = options.filter((o) => o.getAttribute('aria-checked') === 'true')
    const unselected = options.filter((o) => o.getAttribute('aria-checked') === 'false')

    expect(selected).toHaveLength(1)
    expect(unselected).toHaveLength(7)
    expect(selected[0]?.className).toContain('dark:border-blue-300')
    for (const option of unselected) {
      expect(option.className).toContain('dark:border-gray-600')
    }
  })

  /**
   * ⚠️ SEPARATE FROM THE DARK-MODE TEST ON PURPOSE (code review 54.2). The test
   * above asserts colour tokens, so it can only ever prove the two states have
   * DIFFERENT COLOURS — it would pass against a picker whose states differ by hue
   * alone, which is the WCAG 1.4.1 defect the review actually found. This one
   * asserts the non-colour signal: the border WIDTH differs, so the selection
   * survives colour-blindness and a monochrome rendering.
   */
  it('distinguishes the selected icon by border width, not colour alone (story 54.2)', () => {
    useProfileStore.setState({
      profiles: [{ id: 'p1', userId: 'u1', name: 'Main', isDefault: true, currency: 'NONE' }],
      activeProfileId: 'p1',
    })
    renderWithProviders(<EditProfileDialog profileId="p1" onClose={() => {}} />)

    const options = screen.getAllByRole('radio')
    const selected = options.find((o) => o.getAttribute('aria-checked') === 'true')
    const unselected = options.filter((o) => o.getAttribute('aria-checked') === 'false')

    // Class TOKEN membership, not substring: 'border-2' is a substring of nothing
    // here, but 'border-4' vs 'border-2' must be compared as whole tokens.
    const tokens = (el: Element) => el.className.split(/\s+/)
    expect(tokens(selected as Element)).toContain('border-4')
    expect(tokens(selected as Element)).not.toContain('border-2')
    for (const option of unselected) {
      expect(tokens(option)).toContain('border-2')
      expect(tokens(option)).not.toContain('border-4')
    }
  })

  it('gives the BalancePage add/edit modal card a dark surface', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)
    await user.click(screen.getByTestId('balance-add-button'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('dark:bg-gray-800')
  })
})
