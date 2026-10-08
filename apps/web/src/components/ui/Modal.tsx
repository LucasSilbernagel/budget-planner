import { type ReactNode, useCallback, useEffect, useRef } from 'react'

/**
 * Stacked modals are safe, not supported: the background is not inerted, so a dialog
 * behind another is still keyboard-reachable.
 */

export interface ModalProps {
	isOpen: boolean
	/** Called when the modal requests to close (overlay click, Escape, etc.). Must not perform destructive work. */
	onClose: () => void
	children: ReactNode
	labelledBy?: string
	ariaLabel?: string
	describedBy?: string
	role?: 'dialog' | 'alertdialog'
	className?: string
	closeOnOverlayClick?: boolean
	initialFocusRef?: React.RefObject<HTMLElement | null>
	/** Focus target on close, overriding restore-to-trigger; use when the action removes the trigger. */
	finalFocusRef?: React.RefObject<HTMLElement | null>
	testId?: string
}

/**
 * Appended to `className`, which replaces rather than merges the default, so styling a card can't drop it.
 * `max-h-full`, not `vh`: mobile Safari's `vh` is the large viewport and can exceed the visible area.
 */
export const MODAL_CARD_CONSTRAINT = 'max-h-full overflow-y-auto overscroll-contain'

/**
 * Shared across instances: only the topmost modal handles Escape, and the body scroll-lock
 * is taken when the stack becomes non-empty and restored when it empties.
 */
const modalStack: symbol[] = []

/** `body.style.overflow` as it was before the FIRST modal in the stack opened. */
let overflowBeforeLock: string | null = null

function pushModal(id: symbol): void {
	if (modalStack.length === 0) {
		overflowBeforeLock = document.body.style.overflow
		document.body.style.overflow = 'hidden'
	}
	modalStack.push(id)
}

function popModal(id: symbol): void {
	const index = modalStack.lastIndexOf(id)
	if (index !== -1) modalStack.splice(index, 1)
	if (modalStack.length === 0 && overflowBeforeLock !== null) {
		document.body.style.overflow = overflowBeforeLock
		overflowBeforeLock = null
	}
}

function isTopModal(id: symbol): boolean {
	return modalStack.at(-1) === id
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
	const modalIdRef = useRef<symbol | null>(null)
	if (modalIdRef.current === null) {
		modalIdRef.current = Symbol('modal')
	}
	const modalId = modalIdRef.current
	const overlayGestureRef = useRef(false)

	useEffect(() => {
		if (!isOpen) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			// Only the topmost modal closes: `stopPropagation()` doesn't stop sibling listeners on `document`.
			if (!isTopModal(modalId)) return
			event.stopPropagation()
			onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [isOpen, onClose, modalId])

	useEffect(() => {
		if (!isOpen) return
		const previouslyFocused = document.activeElement as HTMLElement | null
		const content = contentRef.current

		if (content) {
			// Focus the container, not the first focusable (usually "Close"), so an immediate Enter can't dismiss.
			const target = initialFocusRef?.current ?? content
			target.focus()
		}

		return () => {
			const restoreTarget = finalFocusRef?.current ?? previouslyFocused
			restoreTarget?.focus?.()
		}
	}, [isOpen, initialFocusRef, finalFocusRef])

	useEffect(() => {
		if (!isOpen) return
		pushModal(modalId)
		return () => popModal(modalId)
	}, [isOpen, modalId])

	const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'Tab') return
		const content = contentRef.current
		if (!content) return
		const focusable = getFocusableElements(content)
		if (focusable.length === 0) {
			event.preventDefault()
			content.focus()
			return
		}
		const first = focusable[0]
		const last = focusable.at(-1)
		// Unreachable after the length check; narrowed for `noUncheckedIndexedAccess`.
		if (!first || !last) return
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

	// Dismiss only when both press and release land on the backdrop: a scrollbar drag or text
	// selection released over the backdrop still fires `click` on the overlay.
	const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		overlayGestureRef.current = event.target === event.currentTarget
	}

	const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		overlayGestureRef.current = overlayGestureRef.current && event.target === event.currentTarget
	}

	// A cancelled press never produces a `click`, so reset the verdict here.
	const handleOverlayPointerCancel = () => {
		overlayGestureRef.current = false
	}

	const handleOverlayClick = () => {
		// Consume the verdict: the ref outlives close/reopen, and a programmatic `click()` must not inherit it.
		const pressedAndReleasedOnBackdrop = overlayGestureRef.current
		overlayGestureRef.current = false
		if (!pressedAndReleasedOnBackdrop) return
		if (closeOnOverlayClick) onClose()
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the overlay's click only triggers dismissal; the keyboard equivalent (Escape) is handled by the document-level listener above, and the dialog content is keyboard-operable on its own.
		<div
			className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
			onPointerDown={handleOverlayPointerDown}
			onPointerUp={handleOverlayPointerUp}
			onPointerCancel={handleOverlayPointerCancel}
			onClick={handleOverlayClick}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useAriaPropsSupportedByRole: role is a dialog/alertdialog prop Biome can't resolve */}
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
