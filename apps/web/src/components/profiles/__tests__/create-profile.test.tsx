import { useProfileStore } from '@/stores/profileStore'
import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, describe, expect, it } from 'vitest'
import { CreateProfileDialog } from '../create-profile'

/**
 * CreateProfileDialog form contract (story 54.1).
 *
 * ⚠️ The currency picker this dialog carried since story 8-2 (labels from story
 * 22-1) is REMOVED (Lucas, 2026-09-16): a profile's currency is read for display
 * nowhere but the profile card row that story 54.5 deletes, so the field was an
 * affordance with no effect. New profiles are created with `currency: 'NONE'`,
 * which was the picker's default. The data model and sync schema keep the column.
 *
 * The name-uniqueness check is the shared `validateProfileForm` with NO exclusion.
 * It used to skip the ACTIVE profile, so a new profile could take its name.
 */
describe('CreateProfileDialog form (story 54.1)', () => {
  afterEach(() => {
    useProfileStore.getState().reset()
  })

  const seed = () => {
    useProfileStore.setState({
      profiles: [
        {
          id: 'main',
          userId: 'u1',
          name: 'Main Profile',
          isDefault: true,
          currency: 'NONE',
        },
      ],
      activeProfileId: 'main',
    })
  }

  it('renders no currency control', () => {
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

    expect(screen.queryByRole('combobox', { name: /currency/i })).toBeNull()
    expect(screen.queryByText(/currency/i)).toBeNull()
  })

  it("creates the profile with currency 'NONE'", async () => {
    seed()
    const user = userEvent.setup()
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

    await user.type(screen.getByLabelText(/profile name/i), 'Business')
    await user.click(screen.getByRole('button', { name: 'Create Profile' }))

    const created = useProfileStore.getState().profiles.find((p) => p.name === 'Business')
    expect(created).toMatchObject({ name: 'Business', currency: 'NONE', isDefault: false })
  })

  it('rejects a new profile named like the ACTIVE profile and adds nothing', async () => {
    seed()
    const user = userEvent.setup()
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

    await user.type(screen.getByLabelText(/profile name/i), 'Main Profile')
    await user.click(screen.getByRole('button', { name: 'Create Profile' }))

    expect(screen.getByText('A profile with this name already exists')).toBeInTheDocument()
    expect(useProfileStore.getState().profiles).toHaveLength(1)
  })
})

/**
 * Story 31.3 — the private `max-h-[90vh] overflow-y-auto` this dialog shipped
 * is replaced by `Modal`'s shared `MODAL_CARD_CONSTRAINT`.
 *
 * ⚠️ **Only the second test guards the deletion.** The first is near-tautological:
 * `Modal` prepends the constraint unconditionally, so it can fail only if this
 * dialog stops using `Modal` altogether — it re-proves `Modal.test.tsx`'s own
 * assertion through a second component. It is kept for exactly that narrow
 * value; the `max-h-[90vh]` absence check is what actually catches a reverted
 * cleanup, and it is the ONLY thing that does, at any layer.
 *
 * `CreateProfileDialog` is premium-gated (`routes/profiles.tsx` →
 * `usePremiumAccess`), so `/profiles` renders only the upgrade surface
 * unauthenticated and the dialog has zero e2e coverage.
 */
describe('CreateProfileDialog viewport fit (story 31.3)', () => {
  const cardTokens = () => {
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)
    return screen.getByRole('dialog').className.split(/\s+/).filter(Boolean)
  }

  it('inherits the shared height constraint from Modal', () => {
    const card = cardTokens()
    expect(card).toContain('max-h-full')
    expect(card).toContain('overflow-y-auto')
    expect(card).toContain('overscroll-contain')
  })

  it('no longer carries its own vh-based max-height', () => {
    // Two competing max-heights on one element is unreadable. `max-h-full`
    // already wins on Tailwind's emitted source order, so this is hygiene —
    // but `vh` is also the wrong unit on mobile Safari (large viewport).
    expect(cardTokens()).not.toContain('max-h-[90vh]')
  })
})
