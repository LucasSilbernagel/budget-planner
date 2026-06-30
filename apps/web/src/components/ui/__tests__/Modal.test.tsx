import { renderWithProviders, screen, userEvent } from '@/test/utils'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from '../Modal'

/**
 * Modal primitive tests (story 6-2).
 *
 * Cover the shared dismissal + focus + semantics behavior that every modal in
 * the app inherits: AC-1 (outside-click), AC-2 (Escape), AC-3 (focus
 * trap/restore + dialog semantics), AC-4 (consistency via the primitive).
 */
describe('Modal', () => {
  function Body() {
    return (
      <>
        <h2 id="modal-title">Test Modal</h2>
        <button type="button">First</button>
        <button type="button">Last</button>
      </>
    )
  }

  it('renders nothing when closed', () => {
    renderWithProviders(
      <Modal isOpen={false} onClose={() => {}} ariaLabel="Test">
        <Body />
      </Modal>
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('exposes dialog semantics with an accessible name', () => {
    renderWithProviders(
      <Modal isOpen onClose={() => {}} labelledBy="modal-title">
        <Body />
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
    // Resolved accessible name comes from the referenced heading.
    expect(screen.getByRole('dialog', { name: 'Test Modal' })).toBeInTheDocument()
  })

  it('falls back to ariaLabel when no labelledBy heading is provided', () => {
    renderWithProviders(
      <Modal isOpen onClose={() => {}} ariaLabel="Add income source">
        <Body />
      </Modal>
    )
    expect(screen.getByRole('dialog', { name: 'Add income source' })).toBeInTheDocument()
  })

  it('closes on Escape (AC-2)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(
      <Modal isOpen onClose={onClose} ariaLabel="Test">
        <Body />
      </Modal>
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on overlay (outside) click (AC-1)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(
      <Modal isOpen onClose={onClose} ariaLabel="Test">
        <Body />
      </Modal>
    )
    // The overlay is the dialog's parent element.
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement
    await user.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close when clicking inside the content (AC-1)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(
      <Modal isOpen onClose={onClose} ariaLabel="Test">
        <Body />
      </Modal>
    )
    await user.click(screen.getByRole('heading', { name: 'Test Modal' }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close on overlay click when closeOnOverlayClick is false', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(
      <Modal isOpen onClose={onClose} ariaLabel="Test" closeOnOverlayClick={false}>
        <Body />
      </Modal>
    )
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement
    await user.click(overlay)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('moves focus to the dialog container on open, not the close button (AC-3)', () => {
    renderWithProviders(
      <Modal isOpen onClose={() => {}} ariaLabel="Test">
        <Body />
      </Modal>
    )
    // Container (role=dialog) takes focus by default so an immediate Enter/Space
    // can't activate the first focusable (often a "Close" button).
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('honors initialFocusRef over the container default (AC-3)', () => {
    function Harness() {
      const ref = useRef<HTMLButtonElement>(null)
      return (
        <Modal isOpen onClose={() => {}} ariaLabel="Test" initialFocusRef={ref}>
          <button type="button">First</button>
          <button type="button" ref={ref}>
            Last
          </button>
        </Modal>
      )
    }
    renderWithProviders(<Harness />)
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
  })

  it('traps Tab focus within the dialog and wraps at the edges (AC-3)', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Modal isOpen onClose={() => {}} ariaLabel="Test">
        <Body />
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })

    // Focus starts on the container; Shift+Tab wraps to the last focusable.
    expect(dialog).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
    // Tab from the last focusable wraps back to the first.
    await user.tab()
    expect(first).toHaveFocus()
  })

  it('restores focus to the triggering element on close (AC-3)', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Test">
            <Body />
          </Modal>
        </>
      )
    }

    renderWithProviders(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
