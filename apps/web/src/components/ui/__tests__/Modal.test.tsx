import { fireEvent, renderWithProviders, screen, userEvent } from '@/test/utils'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MODAL_CARD_CONSTRAINT, Modal } from '../Modal'

/** Class token membership: `toContain('max-h-full')` would false-match `sm:max-h-full`. */
const tokens = (value: string) => value.split(/\s+/).filter(Boolean)

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

    expect(dialog).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
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

// jsdom loads no CSS: these prove class tokens, structure and inline styles only.
describe('Modal viewport fit (story 31.3)', () => {
  function Body() {
    return (
      <>
        <h2 id="modal-title">Test Modal</h2>
        <button type="button">First</button>
      </>
    )
  }

  it('pins the constraint string exactly (AC-2)', () => {
    expect(MODAL_CARD_CONSTRAINT).toBe('max-h-full overflow-y-auto overscroll-contain')
  })

  it('applies all three constraint tokens to the card with the default className (AC-1, AC-2)', () => {
    renderWithProviders(
      <Modal isOpen onClose={() => {}} ariaLabel="Test">
        <Body />
      </Modal>
    )
    const card = tokens(screen.getByRole('dialog').className)
    expect(card).toContain('max-h-full')
    expect(card).toContain('overflow-y-auto')
    expect(card).toContain('overscroll-contain')
  })

  it('keeps the constraint when a caller overrides className (AC-1)', () => {
    renderWithProviders(
      <Modal isOpen onClose={() => {}} ariaLabel="Test" className="custom-thing">
        <Body />
      </Modal>
    )
    const card = tokens(screen.getByRole('dialog').className)
    expect(card).toContain('custom-thing')
    expect(card).toContain('max-h-full')
    expect(card).toContain('overflow-y-auto')
    expect(card).toContain('overscroll-contain')
  })

  it('leaves the overlay layout classes untouched (AC-6)', () => {
    renderWithProviders(
      <Modal isOpen onClose={() => {}} ariaLabel="Test">
        <Body />
      </Modal>
    )
    const overlay = tokens((screen.getByRole('dialog').parentElement as HTMLElement).className)
    expect(overlay).toContain('fixed')
    expect(overlay).toContain('inset-0')
    expect(overlay).toContain('p-4')
    expect(overlay).toContain('items-center')
    expect(overlay).toContain('justify-center')
  })

  it('keeps the card a direct child of the overlay — no wrapper, no portal (AC-9)', () => {
    const { container } = renderWithProviders(
      <Modal isOpen onClose={() => {}} ariaLabel="Test">
        <Body />
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    const overlay = dialog.parentElement as HTMLElement
    // A sizing wrapper between overlay and card would break the two
    // outside-click tests above, which resolve the overlay as `.parentElement`.
    expect(tokens(overlay.className)).toContain('fixed')
    expect(container.contains(dialog)).toBe(true)
  })

  it('locks body scroll while open and restores the previous value on close (AC-8)', () => {
    document.body.style.overflow = 'scroll'
    // `finally`: a failure would otherwise leave `overflow: scroll` on the shared jsdom body.
    try {
      const { rerender } = renderWithProviders(
        <Modal isOpen onClose={() => {}} ariaLabel="Test">
          <Body />
        </Modal>
      )
      expect(document.body.style.overflow).toBe('hidden')

      rerender(
        <Modal isOpen={false} onClose={() => {}} ariaLabel="Test">
          <Body />
        </Modal>
      )
      expect(document.body.style.overflow).toBe('scroll')
    } finally {
      document.body.style.overflow = ''
    }
  })
})

describe('Modal stacking safety (41.1 review)', () => {
  function Body() {
    return <h2>Stacked</h2>
  }

  function twoModals(onCloseA: () => void, onCloseB: () => void) {
    return (
      <>
        <Modal isOpen onClose={onCloseA} ariaLabel="First">
          <Body />
        </Modal>
        <Modal isOpen onClose={onCloseB} ariaLabel="Second">
          <Body />
        </Modal>
      </>
    )
  }

  it('gives Escape to the TOP modal only, never to both at once', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    try {
      renderWithProviders(twoModals(onCloseA, onCloseB))
      expect(screen.getAllByRole('dialog')).toHaveLength(2)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onCloseB).toHaveBeenCalledTimes(1)
      expect(
        onCloseA,
        'one Escape must not close the modal underneath as well'
      ).not.toHaveBeenCalled()
    } finally {
      document.body.style.overflow = ''
    }
  })

  it('holds the scroll lock until the LAST modal closes, then restores the pre-stack value', () => {
    document.body.style.overflow = 'scroll'
    try {
      const { rerender } = renderWithProviders(twoModals(vi.fn(), vi.fn()))
      expect(document.body.style.overflow).toBe('hidden')

      rerender(
        <>
          <Modal isOpen onClose={vi.fn()} ariaLabel="First">
            <Body />
          </Modal>
          <Modal isOpen={false} onClose={vi.fn()} ariaLabel="Second">
            <Body />
          </Modal>
        </>
      )
      expect(document.body.style.overflow, 'the lock must hold while any modal is still open').toBe(
        'hidden'
      )

      // Restores the value from before ANY modal, not the `'hidden'` the second modal observed.
      rerender(
        <>
          <Modal isOpen={false} onClose={vi.fn()} ariaLabel="First">
            <Body />
          </Modal>
          <Modal isOpen={false} onClose={vi.fn()} ariaLabel="Second">
            <Body />
          </Modal>
        </>
      )
      expect(
        document.body.style.overflow,
        'the page must scroll again once every modal has closed'
      ).toBe('scroll')
    } finally {
      document.body.style.overflow = ''
    }
  })

  it('leaves no lock behind when modals close out of order', () => {
    document.body.style.overflow = 'scroll'
    try {
      // Close the BOTTOM one first — the stack must not assume LIFO.
      const { rerender } = renderWithProviders(twoModals(vi.fn(), vi.fn()))
      rerender(
        <>
          <Modal isOpen={false} onClose={vi.fn()} ariaLabel="First">
            <Body />
          </Modal>
          <Modal isOpen onClose={vi.fn()} ariaLabel="Second">
            <Body />
          </Modal>
        </>
      )
      expect(document.body.style.overflow).toBe('hidden')

      rerender(
        <>
          <Modal isOpen={false} onClose={vi.fn()} ariaLabel="First">
            <Body />
          </Modal>
          <Modal isOpen={false} onClose={vi.fn()} ariaLabel="Second">
            <Body />
          </Modal>
        </>
      )
      expect(document.body.style.overflow).toBe('scroll')
    } finally {
      document.body.style.overflow = ''
    }
  })

  it('still closes a lone modal on Escape — the single-modal path is unchanged', () => {
    const onClose = vi.fn()
    try {
      renderWithProviders(
        <Modal isOpen onClose={onClose} ariaLabel="Only">
          <Body />
        </Modal>
      )
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      document.body.style.overflow = ''
    }
  })
})

// Events are dispatched explicitly so the sequence matches a real cross-element drag
// (down on A, up on B, click on their common ancestor).
describe('Modal drag dismissal (story 31.3, AC-7)', () => {
  function setup() {
    const onClose = vi.fn()
    renderWithProviders(
      <Modal isOpen onClose={onClose} ariaLabel="Test">
        <h2 id="modal-title">Test Modal</h2>
      </Modal>
    )
    const card = screen.getByRole('dialog')
    const overlay = card.parentElement as HTMLElement
    return { onClose, card, overlay }
  }

  it('does NOT dismiss when the press began inside the card', () => {
    const { onClose, card, overlay } = setup()
    fireEvent.pointerDown(card)
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does NOT dismiss when the release landed inside the card', () => {
    // Mirror image: a text-selection drag begun on the backdrop and released
    // over the form. A press-origin-only guard leaves this hole wide open.
    const { onClose, card, overlay } = setup()
    fireEvent.pointerDown(overlay)
    fireEvent.pointerUp(card)
    fireEvent.click(overlay)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still dismisses on a genuine backdrop press AND release', () => {
    const { onClose, overlay } = setup()
    fireEvent.pointerDown(overlay)
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not let a completed gesture dismiss a SECOND, pointer-less click', () => {
    // The ref outlives close/reopen, so a consumed verdict must not leak into a later programmatic click.
    const { onClose, overlay } = setup()
    fireEvent.pointerDown(overlay)
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('discards the gesture when the press is cancelled', () => {
    // A touch that becomes a scroll fires pointercancel and never a click; the
    // verdict must not sit in the ref waiting for an unrelated click.
    const { onClose, overlay } = setup()
    fireEvent.pointerDown(overlay)
    fireEvent.pointerCancel(overlay)
    fireEvent.click(overlay)
    expect(onClose).not.toHaveBeenCalled()
  })
})
