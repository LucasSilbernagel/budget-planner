import { isProfileIcon } from '@/lib/profile-appearance'
import { type SyncBridgeHandle, clearSyncBridge, registerSyncBridge } from '@/lib/sync/syncBridge'
import { useProfileStore } from '@/stores/profileStore'
import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

/**
 * Story 98.1 (FR159) — the create dialog renders the picker and stores the choice.
 *
 * ⚠️⚠️ THIS DESCRIBE INVERTS TWO 54.2 REGRESSION TESTS, ON PURPOSE. They were
 * `describe('CreateProfileDialog does not stamp an icon …')` and asserted the
 * created row and the queued create payload carried NO `icon` key. That was right
 * while this dialog had no picker: `form.icon` was always `''`, and spreading it
 * stored `icon: ''` (store AND wire, because `toServerPayload`'s guard is
 * `!= null`), the 54.2 HIGH found by all three review layers.
 *
 * Story 98.1 gives this dialog the SAME picker as edit, 🏠 pre-selected, so a
 * created profile now carries a real, chosen icon by design. What the old tests
 * protected is kept as the (c) assertion below: NO path yields `icon: ''` in the
 * store or in the payload. The dialog guards the value with
 * `isProfileIcon(...) ? … : DEFAULT_PROFILE_ICON`, so `''` is unrepresentable
 * even if a future refactor resets the form wrongly.
 */
describe('CreateProfileDialog icon picker (story 98.1)', () => {
  afterEach(() => {
    clearSyncBridge()
    useProfileStore.getState().reset()
  })

  const bridge = () => {
    const handle = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
      queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
      queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
    }
    registerSyncBridge(handle)
    return handle
  }

  const checkedName = () =>
    screen
      .getAllByRole('radio')
      .find((r) => r.getAttribute('aria-checked') === 'true')
      ?.getAttribute('aria-label')

  const submit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(/profile name/i), 'Investments')
    await user.click(screen.getByRole('button', { name: /create profile/i }))
  }

  const created = () => useProfileStore.getState().profiles.find((p) => p.name === 'Investments')

  it('renders the eight icons as a radiogroup named Profile Icon, 🏠 pre-selected', () => {
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

    expect(screen.getByRole('radiogroup', { name: 'Profile Icon' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(8)
    expect(checkedName()).toBe('Home')
    expect(screen.getByRole('radio', { name: 'Home' })).toHaveTextContent('🏠')
  })

  it('(a) an untouched submit stores and queues icon 🏠', async () => {
    const handle = bridge()
    const user = userEvent.setup()
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)
    await submit(user)

    expect(created()?.icon).toBe('🏠')
    expect(handle.queueCreate).toHaveBeenCalledTimes(1)
    expect(handle.queueCreate.mock.calls[0]?.[2]).toMatchObject({ icon: '🏠' })
  })

  it('(b) a CLICKED choice is stored and queued', async () => {
    const handle = bridge()
    const user = userEvent.setup()
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Briefcase' }))
    await submit(user)

    expect(created()?.icon).toBe('💼')
    expect(handle.queueCreate.mock.calls[0]?.[2]).toMatchObject({ icon: '💼' })
  })

  it('(b) a KEYBOARD choice is stored and queued', async () => {
    const handle = bridge()
    const user = userEvent.setup()
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

    await user.click(screen.getByRole('radio', { name: 'Home' }))
    await user.keyboard('{ArrowRight}')
    expect(checkedName()).toBe('Briefcase')
    expect(screen.getByRole('radio', { name: 'Briefcase' })).toHaveFocus()
    await submit(user)

    expect(created()?.icon).toBe('💼')
    expect(handle.queueCreate.mock.calls[0]?.[2]).toMatchObject({ icon: '💼' })
  })

  it('keeps the same keyboard contract as edit (wrap, Home/End, roving tabindex)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)

    const options = screen.getAllByRole('radio')
    expect(options.filter((o) => o.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(options.filter((o) => o.getAttribute('tabindex') === '-1')).toHaveLength(7)

    await user.click(screen.getByRole('radio', { name: 'Home' }))
    await user.keyboard('{ArrowLeft}')
    expect(checkedName()).toBe('Plane')
    await user.keyboard('{Home}')
    expect(checkedName()).toBe('Home')
    await user.keyboard('{End}')
    expect(checkedName()).toBe('Plane')
  })

  it("does not swallow Escape (preventDefault only for the group's own keys)", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<CreateProfileDialog onClose={onClose} />)

    await user.click(screen.getByRole('radio', { name: 'Lock' }))
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it("(c) no path yields icon '' in the store or the payload (54.2 HIGH, kept)", async () => {
    const handle = bridge()
    const user = userEvent.setup()
    renderWithProviders(<CreateProfileDialog onClose={() => {}} />)
    await submit(user)

    const row = created()
    expect(row).toBeDefined()
    expect(row?.icon).not.toBe('')
    expect(isProfileIcon(row?.icon)).toBe(true)
    const payload = handle.queueCreate.mock.calls[0]?.[2] as Record<string, unknown> | undefined
    expect(payload?.['icon']).not.toBe('')
    expect(isProfileIcon(payload?.['icon'])).toBe(true)
  })
})
