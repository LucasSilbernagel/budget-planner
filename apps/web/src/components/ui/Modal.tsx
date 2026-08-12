import { type ReactNode, useCallback, useEffect, useRef } from 'react'

/**
 * Shared modal primitive (story 6-2).
 *
 * Centralizes the dialog behavior that every modal in the app must share so it
 * is implemented once, consistently:
 * - **Outside-click dismissal**: clicking the backdrop calls `onClose`
 *   (`closeOnOverlayClick`, default true). Clicks inside the content never close,
 *   and neither does a press/release gesture with either end inside the card
 *   (story 31.3) — a scrollbar or text-selection drag must not destroy a form.
 * - **Viewport fit**: the content card is capped at the visible viewport and
 *   scrolls internally via {@link MODAL_CARD_CONSTRAINT}, which is applied on
 *   top of `className` so no caller can opt out (story 31.3).
 * - **Escape dismissal**: a document-level `keydown` listener (active only while
 *   open) closes on Escape. This replaces the previous broken per-page pattern
 *   (a `pointer-events-none` div with `onKeyDown`, which can never receive keys).
 * - **Focus management**: focus moves into the dialog on open (to
 *   `initialFocusRef`, else the first focusable element, else the dialog itself),
 *   is trapped with Tab/Shift+Tab wrapping, and returns to the previously
 *   focused element (the trigger) on close.
 * - **Dialog semantics**: `role="dialog"` + `aria-modal="true"` with an
 *   accessible name from `labelledBy` (preferred) or `ariaLabel`.
 * - **Body scroll lock** while open.
 *
 * Dismissal performs no destructive action — `onClose` should be wired to each
 * caller's cancel/close handler (no save, no delete).
 *
 * SSR-safe: renders nothing when closed and touches the DOM only inside effects,
 * so the server and first client render never read `document`.
 *
 * Assumes a single modal is open at a time (the app never stacks modals). The
 * Escape listener and body-scroll-lock are per-instance, so two simultaneously
 * open modals would both close on one Escape and could restore scroll out of
 * order — revisit with a shared modal stack if nested modals are ever needed.
 */

export interface ModalProps {
  /** Whether the modal is rendered. */
  isOpen: boolean
  /** Called when the modal requests to close (overlay click, Escape, etc.). Must not perform destructive work. */
  onClose: () => void
  /** Modal body. Callers keep their own header/title and form markup. */
  children: ReactNode
  /** id of the visible heading that names the dialog (preferred for accessibility). */
  labelledBy?: string
  /** Accessible name used when no `labelledBy` heading id is available. */
  ariaLabel?: string
  /** id of the element that describes the dialog (e.g. a confirmation message). */
  describedBy?: string
  /** ARIA role. Use `alertdialog` for confirmations/destructive prompts. Default `dialog`. */
  role?: 'dialog' | 'alertdialog'
  /** Classes for the content card. Overrides the default so callers keep their existing look. */
  className?: string
  /** Close when the backdrop is clicked. Default true. */
  closeOnOverlayClick?: boolean
  /** Element to receive focus when the modal opens. Defaults to the first focusable element. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /**
   * Element to receive focus when the modal closes, overriding the default
   * restore-to-trigger. Use when the triggering control is removed as a result
   * of the modal's action (e.g. a confirmed delete) so focus lands on a stable
   * element instead of falling to `<body>`. Applied on close regardless of
   * whether the trigger detached synchronously, so it is robust to async
   * actions. Falls back to the previously focused element when its `.current`
   * is null.
   */
  finalFocusRef?: React.RefObject<HTMLElement | null>
  /** Optional `data-testid` applied to the dialog content element. */
  testId?: string
}

/**
 * Layout classes applied to the content card *in addition to* `className`
 * (story 31.3, UX-DR37), so a caller cannot drop them merely by supplying its
 * own `className`.
 *
 * ⚠️ **This is not a precedence mechanism.** Concatenation order confers no CSS
 * precedence — Tailwind conflicts resolve by STYLESHEET SOURCE ORDER. A future
 * caller that passes a genuinely competing utility (`overflow-hidden`,
 * `max-h-screen`, a responsive variant) can still defeat these, and the unit
 * test guarding this asserts the tokens are PRESENT, not that they are
 * EFFECTIVE. What the constant guarantees is that opting out has to be
 * deliberate: no caller loses the constraint just by styling its card, which
 * is how all four `className`-passing sites were unprotected before.
 *
 * **Why a separate constant and not the `className` default.** `className` is
 * a default PARAMETER assigned verbatim below; there is no `clsx`, no `cn()`
 * and no `tailwind-merge` anywhere in `apps/web`. A caller-supplied string
 * therefore REPLACES the default rather than merging with it. Folding the
 * constraint into the default would reach only the three call sites that don't
 * pass `className`, silently missing `ConfirmDialog` (which fans out to 8
 * sites) and the `BalancePage` add/edit form — the tallest modal in the app.
 *
 * **Why `max-h-full` and not `vh`/`dvh`.** `max-height: 100%` resolves against
 * the overlay's content box, and the overlay is `fixed inset-0 ... p-4`, so the
 * card is capped at exactly the viewport minus the existing 1rem gutter on all
 * four sides, by construction — and stays in sync if that gutter ever changes.
 * `vh` resolves to the LARGE viewport on mobile Safari (URL bar hidden), so
 * `max-h-[90vh]` can still exceed the visible area while the bar is showing:
 * precisely the bug this story exists to kill. `dvh` is the correct unit but
 * has no precedent in this repo and its 90% gutter would be unrelated to the
 * overlay's `p-4`.
 *
 * Holds LAYOUT only, never a visual class a caller might legitimately want to
 * override.
 *
 * Note: `overflow-y-auto` also computes `overflow-x` to `auto` (CSS Overflow 3:
 * a non-`visible` value on one axis forces the other), so the card becomes a
 * horizontal scroll container too. Content that can overflow horizontally needs
 * its own wrap relief — see `ConfirmDialog`'s message `<p>`.
 */
export const MODAL_CARD_CONSTRAINT = 'max-h-full overflow-y-auto overscroll-contain'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true'
  )
}

export function Modal({
  isOpen,
  onClose,
  children,
  labelledBy,
  ariaLabel,
  describedBy,
  role = 'dialog',
  className = 'bg-white dark:bg-gray-800 dark:text-gray-100 rounded-lg shadow-xl max-w-md w-full p-6',
  closeOnOverlayClick = true,
  initialFocusRef,
  finalFocusRef,
  testId,
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  // Whether the current press/release gesture began AND ended on the backdrop
  // itself (story 31.3, AC-7). See `handleOverlayPointerDown` below.
  const overlayGestureRef = useRef(false)

  // Escape to close (document-level so it works regardless of focus position).
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  // Focus management: move focus in on open, restore to the trigger on close.
  useEffect(() => {
    if (!isOpen) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const content = contentRef.current

    if (content) {
      // Default initial focus to the dialog container (screen readers announce
      // its role + name) rather than the first focusable element: in these
      // modals the first focusable is the header "Close" button, and
      // auto-focusing it would let an immediate Enter/Space dismiss the dialog.
      // Callers pass initialFocusRef to focus a specific field instead.
      const target = initialFocusRef?.current ?? content
      target.focus()
    }

    return () => {
      // Prefer an explicit return-focus target (e.g. a stable element when the
      // trigger was removed by the modal's action); otherwise restore to the
      // element that was focused when the modal opened.
      const restoreTarget = finalFocusRef?.current ?? previouslyFocused
      restoreTarget?.focus?.()
    }
  }, [isOpen, initialFocusRef, finalFocusRef])

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  // Trap Tab focus within the dialog.
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const content = contentRef.current
    if (!content) return
    const focusable = getFocusableElements(content)
    if (focusable.length === 0) {
      // Nothing focusable inside: keep focus on the dialog container.
      event.preventDefault()
      content.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey && (active === first || active === content)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  if (!isOpen) return null

  // Dismiss only when BOTH the press and the release landed on the backdrop
  // itself (story 31.3, AC-7).
  //
  // The card is now a scroll container, which puts a scrollbar flush against
  // its edge. Press the thumb, drag, release over the backdrop, and `click`
  // fires on the nearest common inclusive ancestor — the overlay. The card's
  // `stopPropagation` never runs because the card is not in that event's path,
  // and comparing `event.target` on the click does not help either: the target
  // genuinely IS the overlay. Tracking the gesture's endpoints is the only
  // thing that distinguishes a drag from a real backdrop click.
  //
  // Both halves are load-bearing. Press-origin alone still lets a text
  // selection begun on the backdrop and released over the form destroy an
  // unsaved 6-field entry.
  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    overlayGestureRef.current = event.target === event.currentTarget
  }

  const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    overlayGestureRef.current = overlayGestureRef.current && event.target === event.currentTarget
  }

  // A cancelled press (touch turning into a scroll, long-press, the pointer
  // leaving the window) never produces a `click`, so without this the verdict
  // would sit in the ref until the next `pointerdown` overwrote it.
  const handleOverlayPointerCancel = () => {
    overlayGestureRef.current = false
  }

  const handleOverlayClick = () => {
    // CONSUME the gesture. A `click` that is not preceded by a fresh, paired
    // pointer sequence — a programmatic `element.click()`, a synthesized
    // activation — must not inherit the previous gesture's verdict. The ref
    // outlives close/reopen because `isOpen` gates the RENDER, not the mount,
    // so a stale `true` would otherwise survive into the next open.
    const pressedAndReleasedOnBackdrop = overlayGestureRef.current
    overlayGestureRef.current = false
    if (!pressedAndReleasedOnBackdrop) return
    if (closeOnOverlayClick) onClose()
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the overlay's click only triggers dismissal; the keyboard equivalent (Escape) is handled by the document-level listener above, and the dialog content is keyboard-operable on its own.
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onPointerDown={handleOverlayPointerDown}
      onPointerUp={handleOverlayPointerUp}
      onPointerCancel={handleOverlayPointerCancel}
      onClick={handleOverlayClick}
    >
      <div
        ref={contentRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-describedby={describedBy}
        data-testid={testId}
        tabIndex={-1}
        className={`${MODAL_CARD_CONSTRAINT} ${className}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  )
}
