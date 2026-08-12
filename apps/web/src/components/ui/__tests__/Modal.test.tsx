import { fireEvent, renderWithProviders, screen, userEvent } from '@/test/utils'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MODAL_CARD_CONSTRAINT, Modal } from '../Modal'

/**
 * Class TOKEN membership, never `toContain` on the raw className string.
 *
 * `-` and `:` are substring boundaries, so `toContain('overflow-y-auto')`
 * false-matches `md:overflow-y-auto` and `toContain('max-h-full')`
 * false-matches `sm:max-h-full`. Same rule as `src/test/responsive-table-tokens.ts`.
 */
const tokens = (value: string) => value.split(/\s+/).filter(Boolean)

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

/**
 * Story 31.3 (UX-DR37) — the card fits the viewport and scrolls internally.
 *
 * jsdom loads NO CSS: Tailwind never runs, so `max-h-full` / `overflow-y-auto`
 * are inert strings on `class`, `getComputedStyle().overflow` reads `visible`,
 * and every rect / `scrollHeight` / `clientHeight` is 0. These tests therefore
 * prove CLASS TOKENS, DOM STRUCTURE and INLINE STYLES only — the geometry
 * (does it actually fit, does it actually scroll) is proven in Playwright at
 * 320x480 in `e2e/responsive-320.spec.ts`.
 */
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
    // `vh` resolves to the LARGE viewport on mobile Safari, so `max-h-[90vh]`
    // can still exceed the visible area while the URL bar is showing — the
    // exact bug UX-DR37 exists to kill. `max-h-full` resolves against the
    // overlay's content box (`fixed inset-0 ... p-4`), so it stays in sync
    // with the gutter by construction.
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
    // `className` is a default PARAMETER assigned verbatim — no clsx, no
    // tailwind-merge anywhere in apps/web — so a caller-supplied string
    // REPLACES the default. The constraint must be concatenated on top, or the
    // four callers that pass `className` (ConfirmDialog, BalancePage,
    // create-profile, premium-prompt) silently opt out of the fix.
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
    // No portal: the dialog stays inside the render container.
    expect(container.contains(dialog)).toBe(true)
  })

  it('locks body scroll while open and restores the previous value on close (AC-8)', () => {
    document.body.style.overflow = 'scroll'
    // `finally`, not a trailing statement: an assertion failure would otherwise
    // leave `overflow: scroll` on the shared jsdom body for every later test in
    // this worker.
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

/**
 * Story 31.3 (AC-7) — the drag-dismissal regression this story introduces.
 *
 * Putting a scrollbar flush against the card edge turns a press-drag-release
 * into a routine way to lose an unsaved 6-field form: press the scrollbar
 * thumb inside the card, drag, release over the backdrop, and `click` fires on
 * the nearest common inclusive ancestor — the OVERLAY. The card's
 * `stopPropagation` never runs because the card is not in that event's path,
 * and a bare `event.target === overlay` check does not help: the target
 * genuinely IS the overlay.
 *
 * Events are dispatched explicitly rather than through user-event so the
 * sequence matches what a browser actually emits for a cross-element drag
 * (down on A, up on B, click on their common ancestor). This is also why the
 * proof lives here and not in Playwright: this Chromium uses OVERLAY
 * scrollbars (`offsetWidth === clientWidth`), so no scrollbar-drag behaviour is
 * observable in e2e at all.
 */
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
    // The ref outlives close/reopen — `isOpen` gates the render, not the mount
    // — so a consumed `true` must not survive into a later click that had no
    // pointer sequence of its own (programmatic `.click()`, a synthesized
    // activation).
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
