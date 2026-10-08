import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { expectNoDarkFill } from '@/test/white-fill-tokens'
import { ConfirmDialog } from '../ConfirmDialog'

describe('ConfirmDialog', () => {
	it('renders nothing when closed', () => {
		renderWithProviders(
			<ConfirmDialog isOpen={false} onConfirm={() => {}} onCancel={() => {}} message="Delete it?" />
		)
		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
	})

	it('exposes alertdialog semantics with an accessible name + description (AC-1)', () => {
		renderWithProviders(
			<ConfirmDialog
				isOpen
				onConfirm={() => {}}
				onCancel={() => {}}
				title="Confirm Delete"
				message="Are you sure you want to delete this item?"
			/>
		)
		const dialog = screen.getByRole('alertdialog', { name: 'Confirm Delete' })
		expect(dialog).toHaveAttribute('aria-modal', 'true')
		expect(dialog).toHaveAccessibleDescription('Are you sure you want to delete this item?')
	})

	it('fires onConfirm (not onCancel) when Confirm is clicked (AC-3)', async () => {
		const user = userEvent.setup()
		const onConfirm = vi.fn()
		const onCancel = vi.fn()
		renderWithProviders(
			<ConfirmDialog isOpen onConfirm={onConfirm} onCancel={onCancel} message="Delete it?" />
		)
		await user.click(screen.getByTestId('delete-confirm-confirm'))
		expect(onConfirm).toHaveBeenCalledTimes(1)
		expect(onCancel).not.toHaveBeenCalled()
	})

	it('fires onCancel (not onConfirm) when Cancel is clicked (AC-2)', async () => {
		const user = userEvent.setup()
		const onConfirm = vi.fn()
		const onCancel = vi.fn()
		renderWithProviders(
			<ConfirmDialog isOpen onConfirm={onConfirm} onCancel={onCancel} message="Delete it?" />
		)
		await user.click(screen.getByTestId('delete-confirm-cancel'))
		expect(onCancel).toHaveBeenCalledTimes(1)
		expect(onConfirm).not.toHaveBeenCalled()
	})

	it('fires onCancel (not onConfirm) on Escape (AC-2)', async () => {
		const user = userEvent.setup()
		const onConfirm = vi.fn()
		const onCancel = vi.fn()
		renderWithProviders(
			<ConfirmDialog isOpen onConfirm={onConfirm} onCancel={onCancel} message="Delete it?" />
		)
		await user.keyboard('{Escape}')
		expect(onCancel).toHaveBeenCalledTimes(1)
		expect(onConfirm).not.toHaveBeenCalled()
	})

	it('honors custom confirm/cancel labels', () => {
		renderWithProviders(
			<ConfirmDialog
				isOpen
				onConfirm={() => {}}
				onCancel={() => {}}
				message="Delete it?"
				confirmLabel="Remove"
				cancelLabel="Keep"
			/>
		)
		expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument()
		// White on red-500 is 3.76:1, so the dark fill stays red-600.
		expectNoDarkFill(screen.getByRole('button', { name: 'Remove' }))
	})

	it('moves focus to finalFocusRef after a destructive confirm removes the trigger (AC-5)', async () => {
		const user = userEvent.setup()

		function Harness() {
			const [open, setOpen] = useState(false)
			const [deleted, setDeleted] = useState(false)
			const anchorRef = useRef<HTMLButtonElement>(null)
			return (
				<>
					<button type="button" ref={anchorRef}>
						Add
					</button>
					{!deleted && (
						<button type="button" onClick={() => setOpen(true)}>
							Delete
						</button>
					)}
					<ConfirmDialog
						isOpen={open}
						onConfirm={() => {
							setDeleted(true)
							setOpen(false)
						}}
						onCancel={() => setOpen(false)}
						message="Delete it?"
						finalFocusRef={anchorRef}
					/>
				</>
			)
		}

		renderWithProviders(<Harness />)
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await user.click(screen.getByTestId('delete-confirm-confirm'))

		expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus()
	})

	it('routes final focus to finalFocusRef even when the trigger is still mounted at confirm time (AC-5, async-safe)', async () => {
		const user = userEvent.setup()

		// Async delete: the trigger is not removed on confirm, yet focus must still go to finalFocusRef.
		function Harness() {
			const [open, setOpen] = useState(false)
			const anchorRef = useRef<HTMLButtonElement>(null)
			return (
				<>
					<button type="button" ref={anchorRef}>
						Add
					</button>
					<button type="button" onClick={() => setOpen(true)}>
						Delete
					</button>
					<ConfirmDialog
						isOpen={open}
						onConfirm={() => setOpen(false)}
						onCancel={() => setOpen(false)}
						message="Delete it?"
						finalFocusRef={anchorRef}
					/>
				</>
			)
		}

		renderWithProviders(<Harness />)
		await user.click(screen.getByRole('button', { name: 'Delete' }))
		await user.click(screen.getByTestId('delete-confirm-confirm'))

		expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus()
	})
})
