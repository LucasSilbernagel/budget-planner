import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { useBalanceStore } from '../../stores/balanceStore'
import { useProfileStore } from '../../stores/profileStore'
import { BalancePage } from '../BalancePage'
import { CreateProfileDialog } from '../profiles/create-profile'
import { EditProfileDialog } from '../profiles/edit-profile'

// Overriding Modal's className drops its `dark:bg-gray-800`, so these modals must
// supply their own dark surface.
describe('override-modal dark surfaces', () => {
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

	it('gives the edit-profile modal card a dark surface', () => {
		useProfileStore.setState({
			profiles: [{ id: 'p1', userId: 'u1', name: 'Main', isDefault: true, currency: 'NONE' }],
			activeProfileId: 'p1',
		})
		renderWithProviders(<EditProfileDialog profileId="p1" onClose={() => {}} />)
		const dialog = screen.getByRole('dialog')
		expect(dialog.className).toContain('dark:bg-gray-800')
	})

	it('gives both icon-picker states a dark variant', () => {
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

	// Border width differs between states, so selection does not rely on colour alone.
	it('distinguishes the selected icon by border width, not colour alone', () => {
		useProfileStore.setState({
			profiles: [{ id: 'p1', userId: 'u1', name: 'Main', isDefault: true, currency: 'NONE' }],
			activeProfileId: 'p1',
		})
		renderWithProviders(<EditProfileDialog profileId="p1" onClose={() => {}} />)

		const options = screen.getAllByRole('radio')
		const selected = options.find((o) => o.getAttribute('aria-checked') === 'true')
		const unselected = options.filter((o) => o.getAttribute('aria-checked') === 'false')

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
