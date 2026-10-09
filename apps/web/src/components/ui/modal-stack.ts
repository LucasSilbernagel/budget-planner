/**
 * Shared across instances: only the topmost modal handles Escape, and the body scroll-lock
 * is taken when the stack becomes non-empty and restored when it empties.
 */
const modalStack: symbol[] = []

/** `body.style.overflow` as it was before the FIRST modal in the stack opened. */
let overflowBeforeLock: string | null = null

export function pushModal(id: symbol): void {
	if (modalStack.length === 0) {
		overflowBeforeLock = document.body.style.overflow
		document.body.style.overflow = 'hidden'
	}
	modalStack.push(id)
}

export function popModal(id: symbol): void {
	const index = modalStack.lastIndexOf(id)
	if (index !== -1) modalStack.splice(index, 1)
	if (modalStack.length === 0 && overflowBeforeLock !== null) {
		document.body.style.overflow = overflowBeforeLock
		overflowBeforeLock = null
	}
}

export function isTopModal(id: symbol): boolean {
	return modalStack.at(-1) === id
}
