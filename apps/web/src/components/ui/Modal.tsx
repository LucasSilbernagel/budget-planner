import { type ReactNode, useCallback, useEffect, useRef } from 'react'

/**
 * Shared modal primitive (story 6-2).
 *
 * Centralizes the dialog behavior that every modal in the app must share so it
 * is implemented once, consistently:
 * - **Outside-click dismissal**: clicking the backdrop calls `onClose`
 *   (`closeOnOverlayClick`, default true). Clicks inside the content never close.
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

  const handleOverlayClick = () => {
    if (closeOnOverlayClick) onClose()
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the overlay's click only triggers dismissal; the keyboard equivalent (Escape) is handled by the document-level listener above, and the dialog content is keyboard-operable on its own.
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
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
        className={className}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  )
}
