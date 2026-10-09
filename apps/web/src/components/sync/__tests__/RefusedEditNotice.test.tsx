import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	addRefusalNotices,
	dismissAllRefusalNotices,
	type RefusalNotice,
	reconcileNotSyncedNotices,
	resetRefusalNotices,
} from '@/lib/sync/refusalNoticeStore'
import { noticeHeading, RefusedEditNotice, refusalMessage } from '../RefusedEditNotice'

function notice(overrides: Partial<RefusalNotice> = {}): RefusalNotice {
	return {
		key: 'expense:row-1',
		entityType: 'expense',
		name: 'Rent',
		kind: 'expense',
		fallback: 'An expense',
		outcome: 'changed-back',
		...overrides,
	}
}

afterEach(() => {
	cleanup()
	act(() => dismissAllRefusalNotices())
})

describe('RefusedEditNotice', () => {
	it('renders nothing while there is no refusal', () => {
		const { container } = render(<RefusedEditNotice />)
		expect(container).toBeEmptyDOMElement()
	})

	it('announces each refused row in its OWN alert node, naming it and saying it was not saved', () => {
		render(<RefusedEditNotice />)
		act(() =>
			addRefusalNotices([
				notice(),
				notice({ key: 'expense:row-2', name: 'Gym', outcome: 'removed' }),
			])
		)
		const alerts = screen.getAllByRole('alert')
		expect(alerts).toHaveLength(2)
		expect(alerts[0]).toHaveTextContent(
			"Your change to “Rent” (expense) couldn't be saved to your account, so it is being changed back to what your account has."
		)
		expect(alerts[1]).toHaveTextContent(
			"“Gym” (expense) couldn't be saved to your account, so it was removed from this device."
		)
	})

	it('a later refusal is a NEW alert node — the first node is not rewritten', () => {
		render(<RefusedEditNotice />)
		act(() => addRefusalNotices([notice()]))
		const first = screen.getByRole('alert')
		act(() => addRefusalNotices([notice({ key: 'expense:row-2', name: 'Gym' })]))
		expect(screen.getAllByRole('alert')[0]).toBe(first)
		expect(first).toHaveTextContent('Rent')
		expect(first).not.toHaveTextContent('Gym')
	})

	it('dismissing from the keyboard removes that notice only, and does not move focus on arrival', async () => {
		const user = userEvent.setup()
		render(
			<>
				<button type="button">Somewhere else</button>
				<RefusedEditNotice />
			</>
		)
		screen.getByRole('button', { name: 'Somewhere else' }).focus()
		act(() => addRefusalNotices([notice(), notice({ key: 'expense:row-2', name: 'Gym' })]))
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Somewhere else' }))

		const dismiss = screen.getByRole('button', { name: 'Dismiss notice about “Rent” (expense)' })
		dismiss.focus()
		await user.keyboard('{Enter}')
		expect(screen.getAllByRole('alert')).toHaveLength(1)
		expect(screen.getByRole('alert')).toHaveTextContent('Gym')
	})

	it('"Dismiss all" appears only for several notices and clears them', () => {
		render(<RefusedEditNotice />)
		act(() => addRefusalNotices([notice()]))
		expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull()
		act(() => addRefusalNotices([notice({ key: 'expense:row-2', name: 'Gym' })]))
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }))
		expect(screen.queryAllByRole('alert')).toHaveLength(0)
	})

	it('the text stays in the accessibility tree — the dismiss button is a sibling, not a wrapper (63.1)', () => {
		render(<RefusedEditNotice />)
		act(() => addRefusalNotices([notice()]))
		const button = screen.getByRole('button', { name: /^Dismiss notice/ })
		expect(button).not.toHaveTextContent('Rent')
		expect(screen.getByRole('alert')).toHaveTextContent('Not saved to your account')
	})
})

describe('refusalMessage — the fallback never reads as an empty name', () => {
	it.each([
		[
			'removed',
			"An expense couldn't be saved to your account, so it was removed from this device.",
		],
		[
			'changed-back',
			"Your change to an expense couldn't be saved to your account, so it is being changed back to what your account has.",
		],
		[
			'restored',
			"Deleting an expense couldn't be saved to your account, so it is being restored from your account.",
		],
	] as const)('%s', (outcome, text) => {
		const message = refusalMessage(notice({ name: null, outcome }))
		expect(message).toBe(text)
		expect(message).not.toMatch(/“”|undefined|null/)
	})

	it('a removed PROFILE says its entries went with it (the tombstone cascades them)', () => {
		expect(
			refusalMessage(
				notice({
					entityType: 'userProfile',
					name: 'Side hustle',
					kind: 'profile',
					outcome: 'removed',
				})
			)
		).toBe(
			"“Side hustle” (profile) couldn't be saved to your account, so it was removed from this device, together with the entries in it."
		)
	})
})

describe('code review 75.2 fixes', () => {
	it('the same row refused again with a DIFFERENT outcome is a NEW alert node with the new text', () => {
		render(<RefusedEditNotice />)
		act(() => addRefusalNotices([notice()]))
		const first = screen.getByRole('alert')
		act(() => addRefusalNotices([notice({ outcome: 'restored' })]))
		const alerts = screen.getAllByRole('alert')
		expect(alerts).toHaveLength(1)
		expect(alerts[0]).not.toBe(first)
		expect(alerts[0]).toHaveTextContent('is being restored')
	})

	it('"Dismiss all" comes FIRST and the stack scrolls, so it is reachable however many there are', () => {
		render(<RefusedEditNotice />)
		act(() =>
			addRefusalNotices(
				Array.from({ length: 12 }, (_, i) => notice({ key: `expense:row-${i}`, name: `Row ${i}` }))
			)
		)
		const dismissAll = screen.getByRole('button', { name: 'Dismiss all' })
		const container = dismissAll.parentElement as HTMLElement
		expect(container.firstElementChild).toBe(dismissAll)
		expect(container.className).toMatch(/overflow-y-auto/)
		expect(container.className).toMatch(/max-h-/)
	})

	it('sits above a Modal backdrop (z-50)', () => {
		render(<RefusedEditNotice />)
		act(() => addRefusalNotices([notice()]))
		const container = screen.getByRole('alert').parentElement as HTMLElement
		expect(container.className).toMatch(/\bz-\[60\]/)
	})
})

describe('the not-synced notice', () => {
	const stuck = (overrides: Partial<RefusalNotice> = {}): RefusalNotice =>
		notice({ outcome: 'not-synced', change: 'update', ...overrides })

	const REFUSAL_WORDS = /refused|changed back|restored|removed|couldn't be saved|not saved/i

	beforeEach(() => {
		act(() => resetRefusalNotices())
	})

	it.each([
		[
			'update',
			"Your change to “Rent” (expense) hasn't reached your account yet. It's saved on this device and will be sent the next time it syncs.",
		],
		[
			'create',
			"“Rent” (expense) hasn't reached your account yet. It's saved on this device and will be sent the next time it syncs.",
		],
		[
			'delete',
			"Deleting “Rent” (expense) hasn't reached your account yet. It will be sent the next time this device syncs.",
		],
	] as const)(
		'a pending %s says it has not reached the account, never that it was undone',
		(change, text) => {
			const message = refusalMessage(stuck({ change }))
			expect(message).not.toMatch(REFUSAL_WORDS)
			expect(message).toContain("hasn't reached your account yet.")
			expect(message).toBe(text)
		}
	)

	it('a pending delete does not claim the entry is kept on this device', () => {
		const message = refusalMessage(stuck({ change: 'delete' }))
		expect(message).not.toMatch(/saved on this device|kept on this device/)
		expect(message).toMatch(/^Deleting “Rent” \(expense\) hasn't reached your account yet\./)
	})

	it('a nameless entry reads naturally too', () => {
		const message = refusalMessage(stuck({ name: null }))
		expect(message).not.toMatch(REFUSAL_WORDS)
		expect(message).toBe(
			"Your change to an expense hasn't reached your account yet. It's saved on this device and will be sent the next time it syncs."
		)
		expect(message).not.toMatch(/“”|undefined|null/)
	})

	it('an outcome the types did not foresee gets a neutral sentence, never its raw id', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const message = refusalMessage(
			notice({ outcome: 'something-new' as unknown as RefusalNotice['outcome'] })
		)
		expect(message).toBe("“Rent” (expense) hasn't reached your account yet.")
		expect(message).not.toContain('something-new')
		expect(errorSpy).toHaveBeenCalledTimes(1)
		errorSpy.mockRestore()
	})

	it('has its own heading; the refusal heading is unchanged', () => {
		expect(noticeHeading(stuck())).not.toMatch(REFUSAL_WORDS)
		expect(noticeHeading(stuck())).toBe('Not synced yet')
		for (const outcome of ['removed', 'changed-back', 'restored'] as const) {
			expect(noticeHeading(notice({ outcome }))).toBe('Not saved to your account')
		}
	})

	it('renders as an alert naming the entry, with "Try again" and a dismiss, and NO other control', () => {
		render(<RefusedEditNotice onRetry={() => undefined} />)
		act(() => reconcileNotSyncedNotices([stuck()]))

		const alert = screen.getByRole('alert')
		expect(alert).not.toHaveTextContent(REFUSAL_WORDS)
		expect(alert).toHaveTextContent('Not synced yet')
		expect(alert).toHaveTextContent(
			"Your change to “Rent” (expense) hasn't reached your account yet."
		)
		expect(
			within(alert.parentElement as HTMLElement)
				.getAllByRole('button')
				.map((b) => b.getAttribute('aria-label') ?? b.textContent)
		).toEqual(['Try again to sync “Rent” (expense)', 'Dismiss notice about “Rent” (expense)'])
	})

	it('"Try again" calls onRetry, and is disabled while a push is running', () => {
		const onRetry = vi.fn()
		const { rerender } = render(<RefusedEditNotice onRetry={onRetry} />)
		act(() => reconcileNotSyncedNotices([stuck()]))

		const retry = screen.getByRole('button', { name: 'Try again to sync “Rent” (expense)' })
		expect(retry).toHaveTextContent('Try again')
		fireEvent.click(retry)
		expect(onRetry).toHaveBeenCalledTimes(1)

		rerender(<RefusedEditNotice onRetry={onRetry} isRetrying />)
		expect(
			screen.getByRole('button', { name: 'Try again to sync “Rent” (expense)' })
		).toBeDisabled()
	})

	it('a REFUSAL notice never gets "Try again"', () => {
		render(<RefusedEditNotice onRetry={() => undefined} />)
		act(() => addRefusalNotices([notice()]))

		expect(screen.getByRole('alert')).toHaveTextContent('Not saved to your account')
		expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
		expect(
			screen.getByRole('button', { name: 'Dismiss notice about “Rent” (expense)' })
		).toBeTruthy()
	})

	it('"Try again" is a sibling of the text, not its wrapper (63.1)', () => {
		render(<RefusedEditNotice onRetry={() => undefined} />)
		act(() => reconcileNotSyncedNotices([stuck()]))

		const retry = screen.getByRole('button', { name: /^Try again/ })
		const sentence = screen.getByText(/hasn't reached your account yet/)
		const heading = screen.getByText('Not synced yet')
		expect(retry.contains(sentence)).toBe(false)
		expect(retry.contains(heading)).toBe(false)
		expect(sentence.contains(retry)).toBe(false)
		expect(retry.parentElement).toBe(sentence.parentElement)
	})

	it('clears itself when the row is no longer escalated, and stays gone once dismissed', () => {
		render(<RefusedEditNotice onRetry={() => undefined} />)
		act(() => reconcileNotSyncedNotices([stuck(), stuck({ key: 'expense:row-2', name: 'Gym' })]))
		expect(screen.getAllByRole('alert')).toHaveLength(2)

		act(() => reconcileNotSyncedNotices([stuck({ key: 'expense:row-2', name: 'Gym' })]))
		expect(screen.getAllByRole('alert')).toHaveLength(1)
		expect(screen.getByRole('alert')).toHaveTextContent('Gym')

		fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice about “Gym” (expense)' }))
		act(() => reconcileNotSyncedNotices([stuck({ key: 'expense:row-2', name: 'Gym' })]))
		expect(screen.queryAllByRole('alert')).toHaveLength(0)
	})

	it('an update that becomes a delete rewrites the SAME alert node in place', () => {
		render(<RefusedEditNotice onRetry={() => undefined} />)
		act(() => reconcileNotSyncedNotices([stuck()]))
		const first = screen.getByRole('alert')
		expect(first).toHaveTextContent('Your change to “Rent”')

		act(() => reconcileNotSyncedNotices([stuck({ change: 'delete' })]))

		const alerts = screen.getAllByRole('alert')
		expect(alerts).toHaveLength(1)
		expect(alerts[0]).toBe(first)
		expect(first).toHaveTextContent('Deleting “Rent” (expense)')
	})
})

describe('a refused retirement plan edit', () => {
	it.each(['removed', 'changed-back'] as const)(
		'says the plan is still on this device, never that it was %s',
		(outcome) => {
			const message = refusalMessage(
				notice({
					entityType: 'retirementPlan',
					name: null,
					kind: 'retirement plan',
					fallback: 'Your retirement plan',
					outcome,
				})
			)
			expect(message).toBe(
				"Your retirement plan couldn't be saved to your account. It is still saved on this device."
			)
		}
	)
})
