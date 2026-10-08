import { afterEach, describe, expect, it, vi } from 'vitest'
import { profileIcon } from '@/lib/profile-appearance'
import { useProfileStore } from '@/stores/profileStore'
import { act, fireEvent, renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { ProfileList } from '../profile-list'
import { collectClassTokens, RETIRED_LIGHT_ONLY_TOKENS } from './retired-tokens'

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
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
		const user = userEvent.setup()
		renderWithProviders(<ProfileList />)

		await user.click(screen.getByRole('button', { name: 'Edit Business' }))
		// A bare click (no pointerdown) reaches the background button; a pointer gesture
		// would hit the overlay and close the dialog, hiding the defect.
		const mainEdit = screen
			.getAllByRole('button', { hidden: true })
			.find((b) => b.getAttribute('aria-label') === 'Edit Main Profile')
		if (!mainEdit) throw new Error('Edit Main Profile button not found')
		fireEvent.click(mainEdit)

		const dialog = screen.getByRole('dialog', { name: 'Edit Profile' })
		expect(within(dialog).getByLabelText(/profile name/i)).toHaveValue('Main Profile')
	})
})

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
		expect(profileIcon('main')).not.toBe('✈️')
	})

	const biz = { id: 'biz', userId: 'u1', name: 'Business', isDefault: false, currency: 'NONE' }

	it('falls back to exactly the hash icon when no icon is stored (AC-8)', () => {
		useProfileStore.setState({ profiles: [biz], activeProfileId: 'biz' })
		renderWithProviders(<ProfileList />)

		expect(profileIcon('biz')).not.toBe('🏠')
		expect(screen.getByText(profileIcon('biz'))).toBeInTheDocument()
	})

	it('ignores a stored value that is not one of the eight icons', () => {
		useProfileStore.setState({
			profiles: [{ ...biz, icon: '🦄' }],
			activeProfileId: 'biz',
		})
		renderWithProviders(<ProfileList />)

		expect(screen.queryByText('🦄')).toBeNull()
		expect(screen.getByText(profileIcon('biz'))).toBeInTheDocument()
	})

	it('renders the hash fallback for a profile whose stored icon is explicitly null', () => {
		useProfileStore.setState({
			profiles: [{ ...biz, icon: null }],
			activeProfileId: 'biz',
		})
		renderWithProviders(<ProfileList />)

		expect(screen.getByText(profileIcon('biz'))).toBeInTheDocument()
	})

	it('renders 🏠 for the DEFAULT profile with no valid stored icon (story 98.1, D1)', () => {
		expect(profileIcon('main')).not.toBe('🏠')
		for (const icon of [undefined, null, '🦄']) {
			useProfileStore.setState({
				profiles: [{ ...main, icon }, biz],
				activeProfileId: 'main',
			})
			const view = renderWithProviders(<ProfileList />)
			expect(screen.getByText('🏠')).toBeInTheDocument()
			expect(screen.queryByText(profileIcon('main'))).toBeNull()
			expect(screen.getByText(profileIcon('biz'))).toBeInTheDocument()
			view.unmount()
		}
	})
})
describe('ProfileList card is the switcher (story 63.1)', () => {
	// reset() restores data only; zustand keeps actions in state, so a spied action would leak.
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

	// Non-active card on purpose: on the active card a stray switch would be unobservable.
	it('opens Edit without also switching to that card', async () => {
		const user = userEvent.setup()
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
		renderWithProviders(<ProfileList />)

		await user.click(screen.getByRole('button', { name: 'Edit Business' }))

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

		const bizCard = screen
			.getByRole('button', { name: 'Switch to Business' })
			.closest('div.surface')
		if (!(bizCard instanceof HTMLElement)) throw new Error('Business card not found')
		await user.click(within(bizCard).getByRole('button', { name: 'Delete Business' }))
		await user.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		)

		expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['main'])
		expect(useProfileStore.getState().activeProfileId).toBe('main')
	})

	it('deletes from the KEYBOARD without also switching', async () => {
		const user = userEvent.setup()
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
		renderWithProviders(<ProfileList />)

		const bizCard = screen
			.getByRole('button', { name: 'Switch to Business' })
			.closest('div.surface')
		if (!(bizCard instanceof HTMLElement)) throw new Error('Business card not found')
		within(bizCard).getByRole('button', { name: 'Delete Business' }).focus()
		await user.keyboard('{Enter}')
		within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }).focus()
		await user.keyboard('{Enter}')

		expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual(['main'])
		expect(useProfileStore.getState().activeProfileId).toBe('main')
	})

	// Clicking the active card leaves it active either way, so assert the mechanism via a spy.
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

		await user.click(screen.getByRole('button', { name: 'Switch to Business' }))
		expect(switchProfile).toHaveBeenCalledWith('biz')
	})

	it('keeps the active card focusable so its name is still reachable', () => {
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
		renderWithProviders(<ProfileList />)

		const activeRegion = screen.getByRole('button', { name: 'Main Profile (current profile)' })
		activeRegion.focus()
		expect(activeRegion).toHaveFocus()
	})

	it('stays usable and recoverable when the active id resolves to no profile', async () => {
		const user = userEvent.setup()
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'does-not-exist' })
		renderWithProviders(<ProfileList />)

		expect(screen.queryByText('Active Profile')).toBeNull()
		expect(screen.queryByRole('button', { name: /\(current profile\)$/ })).toBeNull()

		expect(screen.getByRole('button', { name: 'Switch to Main Profile' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Switch to Business' })).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'Switch to Business' }))
		expect(useProfileStore.getState().activeProfileId).toBe('biz')

		expect(screen.getByText('Active Profile')).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Business (current profile)' })).toBeInTheDocument()
	})

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
		// Discriminating: in the broken version this text was inside the button, hidden by ARIA.
		expect(control.contains(description)).toBe(false)

		const badge = screen.getByText('Default')
		expect(control.contains(badge)).toBe(false)
	})

	it('presents a lone profile as current, not as something to switch to', () => {
		useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
		renderWithProviders(<ProfileList />)

		expect(
			screen.getByRole('button', { name: 'Main Profile (current profile)' })
		).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: /^Switch to / })).toBeNull()
	})
})

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
		expect([...card.classList]).toContain('border-default')

		const edit = screen.getByRole('button', { name: 'Edit Business' })
		expect([...edit.classList]).toContain('text-accent')
		expect([...edit.classList]).not.toContain('text-blue-600')

		const divider = card.querySelector('div.border-t')
		if (!divider) throw new Error('action-row divider not found')
		expect([...divider.classList]).toContain('border-default')
		expect([...divider.classList]).not.toContain('border-gray-100')

		const del = screen.getByRole('button', { name: 'Delete Business' })
		expect([...del.classList]).toContain('dark:text-red-400')

		// The sweep matches whole tokens, so a missing dark:hover: twin is invisible to it.
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
		expect([...indicator.classList]).toContain('text-green-700')
		expect([...indicator.classList]).not.toContain('text-green-600')
	})

	it('leaves no light-only colour token anywhere in the rendered list (AC-2)', () => {
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
		const { container } = renderWithProviders(<ProfileList />)

		const root = container.firstElementChild
		if (!(root instanceof HTMLElement)) throw new Error('missing ProfileList root')
		expect(within(root).getByText('Business')).toBeInTheDocument()

		const classes = collectClassTokens(root)
		// An empty classes array would pass every not.toContain below for free.
		expect(classes.length).toBeGreaterThan(0)
		expect(classes).toContain('surface')

		for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
			expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
		}
	})

	it('sweeps the single-profile branch too, where the tip box renders (AC-2)', () => {
		useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
		const { container } = renderWithProviders(<ProfileList />)

		const root = container.firstElementChild
		if (!(root instanceof HTMLElement)) throw new Error('missing ProfileList root')
		expect(within(root).getByText(/Create additional profiles/)).toBeInTheDocument()

		const classes = collectClassTokens(root)
		// An empty classes array would pass every not.toContain below for free.
		expect(classes.length).toBeGreaterThan(0)
		expect(classes).toContain('surface')

		for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
			expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
		}
	})

	it('sweeps the empty-state branch too (AC-2)', () => {
		useProfileStore.setState({ profiles: [], activeProfileId: null })
		const { container } = renderWithProviders(<ProfileList />)

		const root = container.firstElementChild
		if (!(root instanceof HTMLElement)) throw new Error('missing ProfileList root')
		expect(within(root).getByText('No profiles yet')).toBeInTheDocument()

		const classes = collectClassTokens(root)
		// An empty classes array would pass every not.toContain below for free.
		expect(classes.length).toBeGreaterThan(0)
		expect(classes).toContain('text-muted')

		for (const retired of RETIRED_LIGHT_ONLY_TOKENS) {
			expect(classes, `retired light-only token "${retired}" survived`).not.toContain(retired)
		}
	})
})

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

		expect(screen.getByText('Main Profile')).toBeInTheDocument()
		expect(screen.getByText('Everyday spending')).toBeInTheDocument()

		expect(screen.queryByText('Currency:')).toBeNull()
		expect(screen.queryByText('EUR')).toBeNull()
	})

	it('shows no "Created:" row (AC-4)', () => {
		useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
		renderWithProviders(<ProfileList />)

		expect(screen.getByRole('button', { name: 'Edit Main Profile' })).toBeInTheDocument()

		expect(screen.queryByText('Created:')).toBeNull()
		expect(screen.queryByText('Jan 15, 2026')).toBeNull()
	})
})

describe('ProfileList delete confirmation (story 63.2)', () => {
	// reset() restores data only; restore the real action so the spy cannot leak.
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

	// A Cancel that reached a refusing removeProfile leaves the same list, so spy the action.
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
		expect(dialog.textContent).toContain('Business')
		expect(dialog.textContent).toMatch(/can(no|')t be undone|cannot be undone/i)
	})

	it('offers Delete on the DEFAULT profile once another profile exists (AC-2)', async () => {
		const user = userEvent.setup()
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'biz' })
		renderWithProviders(<ProfileList />)

		await user.click(screen.getByRole('button', { name: 'Delete Main Profile' }))
		await user.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		)

		const state = useProfileStore.getState()
		expect(state.profiles.map((p) => p.id)).toEqual(['biz'])
		expect(state.profiles.find((p) => p.isDefault)?.id).toBe('biz')
	})

	// Modal reads finalFocusRef.current in a cleanup captured at open, so the ref is mutated:
	// dismissal returns focus to Delete, confirm to the heading.
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

		expect(screen.getByRole('heading', { name: 'Your Profiles' })).toHaveFocus()
	})

	it('still withholds Delete from a lone profile (AC-4, unchanged)', () => {
		useProfileStore.setState({ profiles: [main], activeProfileId: 'main' })
		const { unmount } = renderWithProviders(<ProfileList />)

		expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()

		unmount()
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
		renderWithProviders(<ProfileList />)
		expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(2)
	})
})

describe('ProfileList destructive-delete copy and error surface (story 66.3)', () => {
	const main = { id: 'main', userId: 'u1', name: 'Main Profile', isDefault: true, currency: 'NONE' }
	const biz = { id: 'biz', userId: 'u1', name: 'Business', isDefault: false, currency: 'EUR' }

	afterEach(() => {
		useProfileStore.getState().reset()
	})

	// Anchor on the distinguishing phrase: 'This can't be undone' matches the old wording too.
	it('promises permanent deletion of the data, not merely lost visibility', async () => {
		const user = userEvent.setup()
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
		renderWithProviders(<ProfileList />)

		await user.click(screen.getByRole('button', { name: 'Delete Business' }))

		const dialog = screen.getByRole('alertdialog')
		expect(dialog).toHaveTextContent('will be permanently deleted')
		// Assert each item separately so a dropped one names itself.
		for (const item of [
			'income',
			'expenses',
			'savings goals',
			'balances',
			'categories',
			'saved forecasts',
		]) {
			expect(dialog).toHaveTextContent(item)
		}
		// The old wording must be absent, or both could be rendered side by side.
		expect(dialog).not.toHaveTextContent('no longer be visible')
	})

	it('names the profile being deleted', async () => {
		const user = userEvent.setup()
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main' })
		renderWithProviders(<ProfileList />)

		await user.click(screen.getByRole('button', { name: 'Delete Business' }))

		expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete "Business"?')
	})

	it('renders a store error where the user can see it', () => {
		useProfileStore.setState({
			profiles: [main, biz],
			activeProfileId: 'main',
			error: 'Cannot delete the last profile. Create a new profile first.',
		})
		renderWithProviders(<ProfileList />)

		const alert = screen.getByRole('alert')
		expect(alert).toHaveTextContent('Cannot delete the last profile')
	})

	it('renders no alert when there is no error', () => {
		useProfileStore.setState({ profiles: [main, biz], activeProfileId: 'main', error: null })
		renderWithProviders(<ProfileList />)

		expect(screen.queryByTestId('profile-error')).toBeNull()
	})

	// removeProfile is called directly because the UI withholds Delete from a single-profile list.
	it('surfaces the last-profile refusal raised by the real store', () => {
		useProfileStore.setState({ profiles: [biz], activeProfileId: 'biz', error: null })
		renderWithProviders(<ProfileList />)

		expect(screen.queryByTestId('profile-error')).toBeNull()

		act(() => {
			useProfileStore.getState().removeProfile('biz')
		})

		expect(screen.getByTestId('profile-error')).toHaveTextContent('Cannot delete the last profile')
	})
})
