import { afterEach, describe, expect, it, vi } from 'vitest'
import { isProfileIcon } from '@/lib/profile-appearance'
import { clearSyncBridge, registerSyncBridge, type SyncBridgeHandle } from '@/lib/sync/syncBridge'
import { useProfileStore } from '@/stores/profileStore'
import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { CreateProfileDialog } from '../create-profile'

describe('CreateProfileDialog form', () => {
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

describe('CreateProfileDialog viewport fit', () => {
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
		// `vh` is the wrong unit on mobile Safari; max-h-full already wins on source order.
		expect(cardTokens()).not.toContain('max-h-[90vh]')
	})
})

describe('CreateProfileDialog icon picker', () => {
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
