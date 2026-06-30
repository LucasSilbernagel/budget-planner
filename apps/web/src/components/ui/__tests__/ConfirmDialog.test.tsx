import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../ConfirmDialog'

/**
 * ConfirmDialog tests (story 6-3).
 *
 * ConfirmDialog is a thin wrapper over the shared Modal primitive that renders a
 * themed destructive-confirmation `alertdialog` (replacing browser
 * `confirm()`/`alert()`). It inherits Modal's dismissal + focus behavior, so the
 * tests here focus on the confirm/cancel contract and the post-confirm focus
 * handoff (AC-5), not the overlay/Escape internals (covered by Modal.test.tsx).
 */
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
  })

  it('moves focus to finalFocusRef after a destructive confirm removes the trigger (AC-5)', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      const [deleted, setDeleted] = useState(false)
      const anchorRef = useRef<HTMLButtonElement>(null)
      return (
        <>
          {/* Stable element that survives the delete — focus should land here. */}
          <button type="button" ref={anchorRef}>
            Add
          </button>
          {/* The triggering Delete button is removed when the item is deleted. */}
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

    // The Delete trigger is gone; focus must NOT have fallen to <body>.
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus()
  })

  it('routes final focus to finalFocusRef even when the trigger is still mounted at confirm time (AC-5, async-safe)', async () => {
    const user = userEvent.setup()

    // Simulates an async delete: the triggering button is NOT removed on
    // confirm. The handoff must still land on finalFocusRef rather than letting
    // Modal restore focus to the persistent trigger.
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

    // Trigger persists, but focus must be on the stable anchor, not the trigger.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toHaveFocus()
  })
})
