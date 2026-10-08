import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profileIcon } from '@/lib/profile-appearance'
import {
	clearSyncBridge,
	isSyncActive,
	registerSyncBridge,
	type SyncBridgeHandle,
} from '@/lib/sync/syncBridge'
import { type ClientProfile, useProfileStore } from '@/stores/profileStore'
import { act, renderWithProviders, screen, userEvent } from '@/test/utils'
import { EditProfileDialog } from '../edit-profile'

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
		expect(useProfileStore.getState().activeProfileId).toBe('main')
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
			queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
			queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
			queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
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
			queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
			queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
			queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
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
			queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
			queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
			queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
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
		// undefined would be omitted from the payload, leaving the old description on the server.
		expect(payload).toHaveProperty('description', '')
		expect(payload).toMatchObject({ name: 'Business', currency: 'EUR', isDefault: false })
	})

	describe('code review 54.1', () => {
		it("an unchanged Save does not revert another device's rename pulled while the dialog was open", async () => {
			const user = userEvent.setup()
			const onClose = vi.fn()
			renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

			const renamed = {
				...BUSINESS,
				name: 'Biz (renamed elsewhere)',
				updatedAt: '2026-03-01T00:00:00.000Z',
			}
			act(() => {
				useProfileStore.setState({ profiles: [MAIN, renamed] })
			})
			const before = useProfileStore.getState().profiles

			await user.click(screen.getByRole('button', { name: 'Save Changes' }))

			expect(onClose).toHaveBeenCalledTimes(1)
			expect(useProfileStore.getState().profiles).toBe(before)
			expect(storeProfile('biz')?.name).toBe('Biz (renamed elsewhere)')
		})

		it('an unchanged Save closes even when the stored name already collides with another profile', async () => {
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
			// The bootstrap profile (userId '') is unknown to the server: an update is rejected
			// and the next pull drops it, losing the rename.
			const placeholder: ClientProfile = { ...MAIN, id: 'placeholder', userId: '' }
			useProfileStore.setState({ profiles: [placeholder], activeProfileId: 'placeholder' })
			const handle = {
				userId: SESSION_USER_ID,
				queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
				queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
				queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
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

		// Assert the key's absence: always sending icon would freeze the hash avatar as a choice.
		// updateProfile syncs { ...previous, ...updates }, so a stored icon rides along on every edit.
		it('DOES carry an already-stored icon on the wire when only the name changed', async () => {
			useProfileStore.setState({ profiles: [MAIN, { ...BUSINESS, icon: '✈️' }] })
			const handle = {
				userId: SESSION_USER_ID,
				queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
				queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
				queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
			}
			registerSyncBridge(handle)
			const user = userEvent.setup()
			renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

			const name = screen.getByLabelText(/profile name/i)
			await user.clear(name)
			await user.type(name, 'Renamed')
			await user.click(screen.getByRole('button', { name: 'Save Changes' }))

			expect(storeProfile('biz')?.icon).toBe('✈️')
			// …but the PAYLOAD carries it, because the bridge merges `previous`.
			const payload = handle.queueUpdate.mock.calls[0]?.[2]
			expect(payload['icon']).toBe('✈️')
		})

		it('does not send an icon when the user only renamed the profile', async () => {
			const handle = {
				userId: SESSION_USER_ID,
				queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
				queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
				queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
			}
			registerSyncBridge(handle)
			const user = userEvent.setup()
			renderWithProviders(<EditProfileDialog profileId="biz" onClose={() => {}} />)

			const name = screen.getByLabelText(/profile name/i)
			await user.clear(name)
			await user.type(name, 'Renamed')
			await user.click(screen.getByRole('button', { name: 'Save Changes' }))

			expect(Object.hasOwn(storeProfile('biz') as object, 'icon')).toBe(false)
			const payload = handle.queueUpdate.mock.calls[0]?.[2]
			expect(Object.hasOwn(payload, 'icon')).toBe(false)
		})

		it('queues a sync update carrying the chosen icon', async () => {
			const handle = {
				userId: SESSION_USER_ID,
				queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
				queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
				queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
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
			expect(payload).toMatchObject({ name: 'Business', currency: 'EUR', isDefault: false })
		})

		it('leaves the store alone when the picker is opened but nothing is changed', async () => {
			const user = userEvent.setup()
			const onClose = vi.fn()
			renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

			const before = useProfileStore.getState().profiles
			await user.click(
				screen
					.getAllByRole('radio')
					.find((r) => r.getAttribute('aria-checked') === 'true') as HTMLElement
			)
			await user.click(screen.getByRole('button', { name: 'Save Changes' }))

			expect(useProfileStore.getState().profiles).toBe(before)
			expect(onClose).toHaveBeenCalledTimes(1)
		})

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

		describe('keyboard (WAI-ARIA radiogroup contract)', () => {
			const checkedName = () =>
				screen
					.getAllByRole('radio')
					.find((r) => r.getAttribute('aria-checked') === 'true')
					?.getAttribute('aria-label')

			// 'biz' hashes to 🎯 'Target'; its successor is 📈 'Chart'.
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

			it('does not swallow Escape', async () => {
				const user = userEvent.setup()
				const onClose = vi.fn()
				renderWithProviders(<EditProfileDialog profileId="biz" onClose={onClose} />)

				await user.click(screen.getByRole('radio', { name: 'Lock' }))
				await user.keyboard('{Escape}')

				expect(onClose).toHaveBeenCalled()
			})
		})

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
				queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
				queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
				queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
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
				queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
				queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
				queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
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
