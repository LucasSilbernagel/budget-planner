import { clearSyncBridge, registerSyncBridge } from '@/lib/sync/syncBridge'
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
})
