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

  it('gives the BalancePage add/edit modal card a dark surface', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BalancePage />)
    await user.click(screen.getByTestId('balance-add-button'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('dark:bg-gray-800')
  })
})
