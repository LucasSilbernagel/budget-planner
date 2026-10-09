import { type ReactNode, useId } from 'react'
import { Modal } from './Modal'

/**
 * The destructive button is NOT auto-focused, so an immediate Enter/Space can't confirm a delete.
 * Pass `finalFocusRef` when confirming removes the trigger, or focus falls to `<body>`.
 */
export type ConfirmDialogProps = {
	isOpen: boolean
	onConfirm: () => void
	/** Called on Cancel, backdrop click, or Escape. Must abort the action. */
	onCancel: () => void
	message: ReactNode
	title?: string
	confirmLabel?: string
	cancelLabel?: string
	isConfirming?: boolean
	finalFocusRef?: React.RefObject<HTMLElement | null>
}

export function ConfirmDialog({
	isOpen,
	onConfirm,
	onCancel,
	message,
	title = 'Confirm Delete',
	confirmLabel = 'Delete',
	cancelLabel = 'Cancel',
	isConfirming = false,
	finalFocusRef,
}: ConfirmDialogProps) {
	const titleId = useId()
	const descriptionId = useId()

	return (
		<Modal
			isOpen={isOpen}
			onClose={onCancel}
			role="alertdialog"
			labelledBy={titleId}
			describedBy={descriptionId}
			finalFocusRef={finalFocusRef}
			className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full max-w-[90vw] dark:bg-gray-800 dark:border dark:border-gray-700"
		>
			<h3 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
				{title}
			</h3>
			{/* `break-words` and `MODAL_CARD_CONSTRAINT` are both needed at 320px: the constraint bounds
        the card, this stops a long unbroken name overflowing inside it. */}
			<p id={descriptionId} className="text-gray-600 dark:text-gray-400 mb-6 break-words">
				{message}
			</p>
			<div className="flex gap-3 justify-end">
				<button
					type="button"
					onClick={onCancel}
					disabled={isConfirming}
					className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
					data-testid="delete-confirm-cancel"
				>
					{cancelLabel}
				</button>
				<button
					type="button"
					onClick={onConfirm}
					disabled={isConfirming}
					className="px-4 py-2 bg-red-600 text-white font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
					data-testid="delete-confirm-confirm"
				>
					{confirmLabel}
				</button>
			</div>
		</Modal>
	)
}
