import { type ReactNode, useId } from 'react'
import { Modal } from './Modal'

/**
 * Themed destructive-confirmation dialog (story 6-3).
 *
 * A thin wrapper over the shared {@link Modal} primitive that replaces browser
 * `confirm()`/`alert()` prompts for "Are you sure?" destructive actions. It owns
 * none of the dismissal/focus/scroll-lock mechanics — those live in `Modal` —
 * it only adds the `alertdialog` chrome (title, message, Confirm/Cancel buttons)
 * and the post-confirm focus handoff.
 *
 * Behavior inherited from `Modal`: clicking the backdrop or pressing Escape
 * triggers `onCancel` (never `onConfirm`), so dismissal aborts the destructive
 * action — reusing the story 6-2 dismissal guarantees. The destructive button is
 * intentionally NOT auto-focused (Modal focuses the dialog container), so an
 * immediate Enter/Space can't confirm a delete by accident.
 *
 * **AC-5 focus handoff:** after a destructive confirm the triggering control
 * (e.g. a row's Delete button) is usually removed from the DOM. Modal's default
 * focus-restore would then target a detached node and focus would fall to
 * `<body>`. Pass `finalFocusRef` (a stable element such as the list container or
 * the "Add" button) and it is forwarded to Modal, which focuses it on close
 * instead of the trigger. Routing this through Modal's close handler (rather
 * than focusing eagerly on confirm) makes it robust even when the action is
 * async and the trigger is still mounted at confirm time.
 */
export interface ConfirmDialogProps {
  /** Whether the dialog is rendered. */
  isOpen: boolean
  /** Called when the user confirms the destructive action. */
  onConfirm: () => void
  /** Called on Cancel, backdrop click, or Escape. Must abort the action. */
  onCancel: () => void
  /** The consequence statement shown to the user. */
  message: ReactNode
  /** Heading text. Default "Confirm Delete". */
  title?: string
  /** Label for the destructive button. Default "Delete". */
  confirmLabel?: string
  /** Label for the dismiss button. Default "Cancel". */
  cancelLabel?: string
  /** Disables both buttons while an async confirm is in flight. */
  isConfirming?: boolean
  /** Stable element to focus after a confirm removes the triggering control (AC-5). */
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
      <p id={descriptionId} className="text-gray-600 dark:text-gray-400 mb-6">
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
          className="px-4 py-2 bg-red-600 text-white font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-red-500 dark:hover:bg-red-600"
          data-testid="delete-confirm-confirm"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
