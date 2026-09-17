import { profileIcon } from '@/lib/profile-appearance'
import { clearSyncBridge, isSyncActive, registerSyncBridge } from '@/lib/sync/syncBridge'
import { type ClientProfile, useProfileStore } from '@/stores/profileStore'
import { act, renderWithProviders, screen, userEvent } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditProfileDialog } from '../edit-profile'

/**
 * EditProfileDialog (story 54.1, FR77).
 *
 * Edits a profile's name and description through `useProfileManager().modifyProfile`.
 * Currency is deliberately NOT editable (Lucas, 2026-09-16): a profile's currency is
 * read for display nowhere but the card row story 54.5 removes, so the dialog never
 * renders it and never sends it — an existing profile keeps whatever it has.
 */

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

const MAIN: ClientProfile = {
  id: 'main',
  userId: SESSION_USER_ID,
  name: 'Main Profile',
  description: 'Your primary financial profile',
  isDefault: true,
  currency: 'NONE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const BUSINESS: ClientProfile = {
  id: 'biz',
  userId: SESSION_USER_ID,
  name: 'Business',
  description: 'Freelance work',
  isDefault: false,
  currency: 'EUR',
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
}

const seed = () => {
  useProfileStore.setState({ profiles: [MAIN, BUSINESS], activeProfileId: 'main' })
}

const storeProfile = (id: string) => useProfileStore.getState().profiles.find((p) => p.id === id)

describe('EditProfileDialog (story 54.1)', () => {
  beforeEach(seed)

  afterEach(() => {
    clearSyncBridge()
    useProfileStore.getState().reset()
    vi.restoreAllMocks()
  })

  it("pre-populates the profile's current name and description", () => {
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: 'Edit Profile' })).toBeInTheDocument()
    expect(screen.getByLabelText(/profile name/i)).toHaveValue('Business')
    expect(screen.getByLabelText(/description/i)).toHaveValue('Freelance work')
  })

  it('renders no currency control', () => {
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

    expect(screen.queryByRole('combobox', { name: /currency/i })).toBeNull()
    expect(screen.queryByText(/currency/i)).toBeNull()
  })

  it('saves name and description, bumps updatedAt, and leaves every other field alone', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

    const name = screen.getByLabelText(/profile name/i)
    await user.clear(name)
    await user.type(name, 'Side Business')
    const description = screen.getByLabelText(/description/i)
    await user.clear(description)
    await user.type(description, 'Weekend gigs')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    const saved = storeProfile('biz')
    expect(saved).toMatchObject({
      id: 'biz',
      userId: SESSION_USER_ID,
      name: 'Side Business',
      description: 'Weekend gigs',
      isDefault: false,
      currency: 'EUR',
      createdAt: BUSINESS.createdAt,
    })
    expect(saved?.updatedAt).not.toBe(BUSINESS.updatedAt)
    // Editing never switches profiles (54.4 scopes every page by this id).
    expect(useProfileStore.getState().activeProfileId).toBe('main')
    // The other profile is untouched.
    expect(storeProfile('main')).toEqual(MAIN)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("rejects renaming a NON-active profile to another profile's name", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

    const name = screen.getByLabelText(/profile name/i)
    await user.clear(name)
    await user.type(name, 'Main Profile')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(screen.getByText('A profile with this name already exists')).toBeInTheDocument()
    expect(storeProfile('biz')).toEqual(BUSINESS)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('saves a profile under its own unchanged name', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

    await user.type(screen.getByLabelText(/description/i), '!')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(screen.queryByText('A profile with this name already exists')).toBeNull()
    expect(storeProfile('biz')?.description).toBe('Freelance work!')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("stores a cleared description as '' (never undefined)", async () => {
    const user = userEvent.setup()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

    await user.clear(screen.getByLabelText(/description/i))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    const saved = storeProfile('biz')
    expect(saved).toHaveProperty('description', '')
  })

  it('Cancel leaves the store unchanged', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

    const handle = {
      userId: SESSION_USER_ID,
      queueCreate: vi.fn(async () => {}),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    }
    registerSyncBridge(handle)

    await user.type(screen.getByLabelText(/profile name/i), ' edited')
    const before = useProfileStore.getState().profiles
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(useProfileStore.getState().profiles).toBe(before)
    expect(storeProfile('biz')).toEqual(BUSINESS)
    expect(handle.queueUpdate).not.toHaveBeenCalled()
  })

  it('✕ closes without writing the store or queueing a sync op (code review 54.1)', async () => {
    const handle = {
      userId: SESSION_USER_ID,
      queueCreate: vi.fn(async () => {}),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    }
    registerSyncBridge(handle)
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

    await user.type(screen.getByLabelText(/profile name/i), ' edited')
    const before = useProfileStore.getState().profiles
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(useProfileStore.getState().profiles).toBe(before)
    expect(handle.queueUpdate).not.toHaveBeenCalled()
  })

  it('Escape leaves the store unchanged', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

    await user.type(screen.getByLabelText(/profile name/i), ' edited')
    const before = useProfileStore.getState().profiles
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
    expect(useProfileStore.getState().profiles).toBe(before)
  })

  it('an unchanged Save closes without writing the store', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

    const before = useProfileStore.getState().profiles
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(useProfileStore.getState().profiles).toBe(before)
  })

  it('closes itself when the profile no longer exists', () => {
    const onClose = vi.fn()
    renderWithProviders(<EditProfileDialog profileId="gone" onClose={onClose} />)

    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it("queues a sync update that clears the description and keeps the profile's currency", async () => {
    const handle = {
      userId: SESSION_USER_ID,
      queueCreate: vi.fn(async () => {}),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    }
    registerSyncBridge(handle)
    const user = userEvent.setup()
    renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

    await user.clear(screen.getByLabelText(/description/i))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
    const [entityType, entityId, payload] = handle.queueUpdate.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ]
    expect(entityType).toBe('userProfile')
    expect(entityId).toBe('biz')
    // ⚠️ `toServerPayload` omits a null/undefined description, and the server only
    // SETs fields present — so an `undefined` here would leave the OLD description
    // on the server and a pull would restore it on every device.
    expect(payload).toHaveProperty('description', '')
    expect(payload).toMatchObject({ name: 'Business', currency: 'EUR', isDefault: false })
  })

  describe('code review 54.1', () => {
    it("an unchanged Save does not revert another device's rename pulled while the dialog was open", async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

      // A pull replaces the profile under the open dialog.
      const renamed = {
        ...BUSINESS,
        name: 'Biz (renamed elsewhere)',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }
      act(() => {
        useProfileStore.setState({ profiles: [MAIN, renamed] })
      })
      const before = useProfileStore.getState().profiles

      // The user never typed: Save must be a no-op, not a write of the stale name.
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(onClose).toHaveBeenCalledTimes(1)
      expect(useProfileStore.getState().profiles).toBe(before)
      expect(storeProfile('biz')?.name).toBe('Biz (renamed elsewhere)')
    })

    it('an unchanged Save closes even when the stored name already collides with another profile', async () => {
      // Two devices can merge duplicate names (no server uniqueness constraint).
      useProfileStore.setState({
        profiles: [MAIN, { ...BUSINESS, name: 'Main Profile' }],
        activeProfileId: 'main',
      })
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(screen.queryByText('A profile with this name already exists')).toBeNull()
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('refuses to edit the un-synced placeholder profile while sync is active', async () => {
      // A paid session before its first pull still holds the module-seeded
      // default (`userId: ''`), which the server has never seen: an update for it
      // is rejected and the next pull drops the placeholder, losing the rename.
      const placeholder: ClientProfile = { ...MAIN, id: 'placeholder', userId: '' }
      useProfileStore.setState({ profiles: [placeholder], activeProfileId: 'placeholder' })
      const handle = {
        userId: SESSION_USER_ID,
        queueCreate: vi.fn(async () => {}),
        queueUpdate: vi.fn(async () => {}),
        queueDelete: vi.fn(async () => {}),
      }
      registerSyncBridge(handle)
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderWithProviders(<EditProfileDialog profileId="placeholder" onClose={onClose} />)

      const name = screen.getByLabelText(/profile name/i)
      await user.clear(name)
      await user.type(name, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(
        screen.getByText('This profile is still syncing. Please try again in a moment.')
      ).toBeInTheDocument()
      expect(useProfileStore.getState().profiles[0]?.name).toBe('Main Profile')
      expect(handle.queueUpdate).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('still edits the placeholder profile on the free tier (no sync)', async () => {
      const placeholder: ClientProfile = { ...MAIN, id: 'placeholder', userId: '' }
      useProfileStore.setState({ profiles: [placeholder], activeProfileId: 'placeholder' })
      const user = userEvent.setup()
      renderWithProviders(<EditProfileDialog profileId="placeholder" onClose={() => {}} />)

      const name = screen.getByLabelText(/profile name/i)
      await user.clear(name)
      await user.type(name, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(useProfileStore.getState().profiles[0]?.name).toBe('Renamed')
    })
  })

  /**
   * Story 54.2 (FR78): the icon picker.
   *
   * `BUSINESS` has no stored icon, so its picker opens on the HASH-derived
   * fallback — the emoji the card already shows. `profileIcon('biz')` is the
   * honest way to name that here; hard-coding the emoji would pin the hash twice
   * and `profile-appearance.test.ts` already owns that job.
   */
  describe('icon picker (story 54.2)', () => {
    const hashIconFor = (id: string) => profileIcon(id)

    it('renders the eight fixed icons as a radiogroup', () => {
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

      const group = screen.getByRole('radiogroup', { name: /profile icon/i })
      expect(group).toBeInTheDocument()
      expect(screen.getAllByRole('radio')).toHaveLength(8)
    })

    it('opens on the hash fallback for a profile that has never chosen an icon', () => {
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

      const checked = screen
        .getAllByRole('radio')
        .filter((r) => r.getAttribute('aria-checked') === 'true')
      expect(checked).toHaveLength(1)
      expect(checked[0]).toHaveTextContent(hashIconFor('biz'))
    })

    it('opens on the stored icon when the profile has one', () => {
      useProfileStore.setState({ profiles: [MAIN, { ...BUSINESS, icon: '✈️' }] })
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

      const checked = screen
        .getAllByRole('radio')
        .filter((r) => r.getAttribute('aria-checked') === 'true')
      expect(checked).toHaveLength(1)
      expect(checked[0]).toHaveTextContent('✈️')
    })

    /**
     * ⚠️ THE STORY'S NAMED TRAP (AC-7). The dialog skips the write when nothing
     * changed, and that check knew only about name and description. An icon-only
     * edit would close silently, saving nothing, with every other test still green.
     */
    it('saves when ONLY the icon changed', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

      await user.click(screen.getByRole('radio', { name: 'Chart' }))
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(storeProfile('biz')?.icon).toBe('📈')
      expect(storeProfile('biz')?.name).toBe('Business')
      expect(storeProfile('biz')?.updatedAt).not.toBe(BUSINESS.updatedAt)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    /**
     * ⚠️ Decision 3. The picker opens pre-selected on the hash fallback, so if the
     * updates object always carried `icon`, renaming a profile would silently
     * freeze its hash avatar into the database as a deliberate choice — a write
     * the user never made, and one that would then survive any future change to
     * the hash. Assert the KEY's absence, not its value.
     */
    /**
     * The companion to the test below, added by code review 54.2. That one uses
     * the `BUSINESS` fixture, which has NO stored icon — so on its own it proves
     * nothing about a profile that HAS one. This pins the real (and less
     * comfortable) behaviour: `updateProfile` syncs `{ ...previous, ...updates }`,
     * so a stored icon rides along on every later edit even when the user only
     * touched the name. Pre-existing last-write-wins, logged in deferred-work.md —
     * recorded here so the pair together describe what actually happens.
     */
    it('DOES carry an already-stored icon on the wire when only the name changed', async () => {
      useProfileStore.setState({ profiles: [MAIN, { ...BUSINESS, icon: '✈️' }] })
      const handle = {
        userId: SESSION_USER_ID,
        queueCreate: vi.fn(async () => {}),
        queueUpdate: vi.fn(async () => {}),
        queueDelete: vi.fn(async () => {}),
      }
      registerSyncBridge(handle)
      const user = userEvent.setup()
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

      const name = screen.getByLabelText(/profile name/i)
      await user.clear(name)
      await user.type(name, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      // The local updates object carried no icon — the stored value is untouched…
      expect(storeProfile('biz')?.icon).toBe('✈️')
      // …but the PAYLOAD carries it, because the bridge merges `previous`.
      const payload = handle.queueUpdate.mock.calls[0]?.[2] as Record<string, unknown>
      expect(payload['icon']).toBe('✈️')
    })

    it('does not send an icon when the user only renamed the profile', async () => {
      const handle = {
        userId: SESSION_USER_ID,
        queueCreate: vi.fn(async () => {}),
        queueUpdate: vi.fn(async () => {}),
        queueDelete: vi.fn(async () => {}),
      }
      registerSyncBridge(handle)
      const user = userEvent.setup()
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

      const name = screen.getByLabelText(/profile name/i)
      await user.clear(name)
      await user.type(name, 'Renamed')
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(Object.hasOwn(storeProfile('biz') as object, 'icon')).toBe(false)
      const payload = handle.queueUpdate.mock.calls[0]?.[2] as Record<string, unknown>
      expect(Object.hasOwn(payload, 'icon')).toBe(false)
    })

    it('queues a sync update carrying the chosen icon', async () => {
      const handle = {
        userId: SESSION_USER_ID,
        queueCreate: vi.fn(async () => {}),
        queueUpdate: vi.fn(async () => {}),
        queueDelete: vi.fn(async () => {}),
      }
      registerSyncBridge(handle)
      const user = userEvent.setup()
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

      await user.click(screen.getByRole('radio', { name: 'Chart' }))
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
      const [entityType, entityId, payload] = handle.queueUpdate.mock.calls[0] as unknown as [
        string,
        string,
        Record<string, unknown>,
      ]
      expect(entityType).toBe('userProfile')
      expect(entityId).toBe('biz')
      expect(payload['icon']).toBe('📈')
      // The existing fields still ride along.
      expect(payload).toMatchObject({ name: 'Business', currency: 'EUR', isDefault: false })
    })

    it('leaves the store alone when the picker is opened but nothing is changed', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

      const before = useProfileStore.getState().profiles
      // Re-select the icon that is ALREADY selected: still "unchanged".
      await user.click(
        screen
          .getAllByRole('radio')
          .find((r) => r.getAttribute('aria-checked') === 'true') as HTMLElement
      )
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(useProfileStore.getState().profiles).toBe(before)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    /**
     * AC-9. The free tier has no sync bridge at all, so `syncEntityUpdate` returns
     * immediately and the pick is a purely local write. (The profiles PAGE is
     * premium-gated, so a free user cannot reach this dialog in the product — this
     * pins that the code path is nonetheless correct.)
     *
     * ⚠️ The "no bridge is registered" half is now ASSERTED (`isSyncActive()`),
     * not merely assumed. Code review 54.2: this docblock previously claimed the
     * test proved "no network call" while asserting only the store write.
     */
    it('stores an icon locally on the free tier, with no sync bridge registered', async () => {
      const placeholder: ClientProfile = { ...MAIN, id: 'placeholder', userId: '' }
      useProfileStore.setState({ profiles: [placeholder], activeProfileId: 'placeholder' })
      expect(isSyncActive()).toBe(false)
      const user = userEvent.setup()
      renderWithProviders(<EditProfileDialog profileId="placeholder" onClose={() => {}} />)

      await user.click(screen.getByRole('radio', { name: 'Chart' }))
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(useProfileStore.getState().profiles[0]?.icon).toBe('📈')
      expect(isSyncActive()).toBe(false)
    })

    /**
     * The radiogroup keyboard contract (code review 54.2). Choosing `role="radio"`
     * makes assistive tech tell the user to arrow between options, so the arrows
     * must actually work. Nothing exercised the keyboard before this.
     */
    describe('keyboard (WAI-ARIA radiogroup contract)', () => {
      const checkedName = () =>
        screen
          .getAllByRole('radio')
          .find((r) => r.getAttribute('aria-checked') === 'true')
          ?.getAttribute('aria-label')

      // MEASURED, not assumed: 'biz' hashes to index 3 = 🎯 'Target', whose
      // successor is 📈 'Chart'. (A first draft of this test guessed 'Lock' and
      // went red — the same mistake the hash-literal pin in
      // `profile-appearance.test.ts` exists to catch.)
      it('ArrowRight moves to the next icon and selects it', async () => {
        const user = userEvent.setup()
        renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

        expect(checkedName()).toBe('Target')
        await user.click(screen.getByRole('radio', { name: 'Target' }))
        await user.keyboard('{ArrowRight}')

        expect(checkedName()).toBe('Chart')
        expect(screen.getByRole('radio', { name: 'Chart' })).toHaveFocus()
      })

      it('ArrowLeft wraps backwards from the first option', async () => {
        const user = userEvent.setup()
        renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

        await user.click(screen.getByRole('radio', { name: 'Home' }))
        await user.keyboard('{ArrowLeft}')

        expect(checkedName()).toBe('Plane')
      })

      it('Home and End jump to the first and last icons', async () => {
        const user = userEvent.setup()
        renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

        await user.click(screen.getByRole('radio', { name: 'Lock' }))
        await user.keyboard('{End}')
        expect(checkedName()).toBe('Plane')

        await user.keyboard('{Home}')
        expect(checkedName()).toBe('Home')
      })

      it('puts exactly one option in the tab order (roving tabindex)', () => {
        renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

        const options = screen.getAllByRole('radio')
        expect(options.filter((o) => o.getAttribute('tabindex') === '0')).toHaveLength(1)
        expect(options.filter((o) => o.getAttribute('tabindex') === '-1')).toHaveLength(7)
      })

      /**
       * A key the group does not handle must keep its default behaviour — the
       * handler calls `preventDefault` only after it has matched. Escape still
       * closing the modal is the observable proof.
       */
      it('does not swallow Escape', async () => {
        const user = userEvent.setup()
        const onClose = vi.fn()
        renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

        await user.click(screen.getByRole('radio', { name: 'Lock' }))
        await user.keyboard('{Escape}')

        expect(onClose).toHaveBeenCalled()
      })
    })

    /**
     * Task 6.1's "Cancel/Escape write nothing" for an ICON change specifically —
     * the code review found the existing dismissal tests only ever change the
     * name, so none of them covered the picker.
     */
    it.each([
      [
        'Cancel',
        async (user: ReturnType<typeof userEvent.setup>) => {
          await user.click(screen.getByRole('button', { name: 'Cancel' }))
        },
      ],
      [
        'Escape',
        async (user: ReturnType<typeof userEvent.setup>) => {
          await user.keyboard('{Escape}')
        },
      ],
    ])('%s after choosing an icon writes nothing and queues nothing', async (_label, dismiss) => {
      const handle = {
        userId: SESSION_USER_ID,
        queueCreate: vi.fn(async () => {}),
        queueUpdate: vi.fn(async () => {}),
        queueDelete: vi.fn(async () => {}),
      }
      registerSyncBridge(handle)
      const user = userEvent.setup()
      renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

      await user.click(screen.getByRole('radio', { name: 'Chart' }))
      const before = useProfileStore.getState().profiles
      await dismiss(user)

      expect(useProfileStore.getState().profiles).toBe(before)
      expect(storeProfile('biz')).toEqual(BUSINESS)
      expect(handle.queueUpdate).not.toHaveBeenCalled()
    })

    it('refuses an icon-only edit of the un-synced placeholder while sync is active', async () => {
      const placeholder: ClientProfile = { ...MAIN, id: 'placeholder', userId: '' }
      useProfileStore.setState({ profiles: [placeholder], activeProfileId: 'placeholder' })
      const handle = {
        userId: SESSION_USER_ID,
        queueCreate: vi.fn(async () => {}),
        queueUpdate: vi.fn(async () => {}),
        queueDelete: vi.fn(async () => {}),
      }
      registerSyncBridge(handle)
      const user = userEvent.setup()
      renderWithProviders(<EditProfileDialog profileId="placeholder" onClose={() => {}} />)

      await user.click(screen.getByRole('radio', { name: 'Chart' }))
      await user.click(screen.getByRole('button', { name: 'Save Changes' }))

      expect(
        screen.getByText('This profile is still syncing. Please try again in a moment.')
      ).toBeInTheDocument()
      expect(handle.queueUpdate).not.toHaveBeenCalled()
    })
  })
})
