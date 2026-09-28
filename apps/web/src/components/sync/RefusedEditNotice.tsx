import {
  type RefusalNotice,
  dismissAllRefusalNotices,
  dismissRefusalNotice,
  useRefusalNotices,
} from '@/lib/sync/refusalNoticeStore'
import type { ReactElement } from 'react'

/**
 * Tells a paid user which of their edits the server permanently refused, and
 * what this device did about it (story 75.2, FR119). Rendered by `ActiveSync`,
 * so it ships in the lazily-loaded sync chunk only a paid session downloads.
 *
 * ⚠️ `role="alert"`, not `status` — chosen on purpose. The user's own edit was
 * just undone on screen with no action of theirs; a polite `status` can queue
 * behind other announcements indefinitely. Precedent: the refusal alert in
 * `profiles/profile-list.tsx`, which also "arrives with no focus change".
 *
 * ⚠️ `role="alert"` announces on INSERTION, not when an already-mounted node's
 * text changes (`forecasting/scenario-builder.tsx`). So each refused row gets
 * its OWN node, mounted with its text; a later refusal inserts a new node
 * rather than rewriting an old one.
 *
 * ⚠️ Positioned at the TOP of the viewport on every width, deliberately. The
 * bottom is taken by the mobile GlobalNav bar and `pwa/InstallPrompt.tsx`,
 * whose offsets form a three-way rem+px coupling documented in
 * `routes/__root.tsx`; a fourth bottom-anchored site would join that coupling.
 * It DOES cover the top of the page while shown — including `/forecasting`'s
 * `sticky top-0` header (corrected by code review 75.2) — which is why every
 * notice is dismissable, the stack scrolls instead of running off-screen, and
 * "Dismiss all" comes FIRST, where it is always reachable.
 *
 * ⚠️ `z-[60]`, one above `ui/Modal.tsx`'s `z-50` backdrop: a refusal can arrive
 * while a dialog is open, and at an equal z-index the later-in-DOM backdrop
 * covered the notice and made it undismissable (code review 75.2).
 *
 * Focus is never moved: the notice interrupts nothing. The dismiss buttons are
 * SIBLINGS of the text, never its wrapper — a labelled `<button>` hides its
 * children from the accessibility tree (story 63.1).
 */
export function RefusedEditNotice(): ReactElement | null {
  const notices = useRefusalNotices()
  if (notices.length === 0) {
    return null
  }
  return (
    <div className="fixed top-4 left-1/2 z-[60] flex max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 overflow-y-auto">
      {notices.length > 1 ? (
        <button
          type="button"
          onClick={dismissAllRefusalNotices}
          className="self-end rounded-md bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          Dismiss all
        </button>
      ) : null}
      {notices.map((notice) => (
        <div
          // The OUTCOME is part of the React key: a later refusal of the same
          // row with a different outcome must be a NEW node, because
          // `role="alert"` announces on insertion, not on a text change.
          key={`${notice.key}:${notice.outcome}`}
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg dark:border-amber-700 dark:bg-gray-800"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              Not saved to your account
            </p>
            <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
              {refusalMessage(notice)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => dismissRefusalNotice(notice.key)}
            aria-label={`Dismiss notice about ${subject(notice)}`}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-gray-500 hover:bg-amber-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <span aria-hidden="true" className="block h-4 w-4 text-center text-lg leading-4">
              &times;
            </span>
          </button>
        </div>
      ))}
    </div>
  )
}

/** `“Rent” (expense)` when the entry has a name; `an expense` when it has none. */
function subject(notice: RefusalNotice): string {
  if (notice.name !== null) {
    return `“${notice.name}” (${notice.kind})`
  }
  return notice.fallback.charAt(0).toLowerCase() + notice.fallback.slice(1)
}

/** Every outcome says the same thing about the account (AC-1). */
const NOT_SAVED = "couldn't be saved to your account"

/**
 * The sentence for one refused row. Exported for its unit test.
 *
 * ⚠️ Worded to be TRUE WHEN SHOWN (code review 75.2). A removal is done before
 * the notice appears. A change-back or restore is a full re-pull that is only
 * REQUESTED at that moment — it can wait on an in-flight pull, on later pages,
 * or on the profile being active — so those say it is under way, not done.
 */
export function refusalMessage(notice: RefusalNotice): string {
  const what = subject(notice)
  switch (notice.outcome) {
    case 'removed':
      // A profile's rows go with it (the tombstone cascades them), so say so.
      return notice.entityType === 'userProfile'
        ? `${capitalise(
            what
          )} ${NOT_SAVED}, so it was removed from this device, together with the entries in it.`
        : `${capitalise(what)} ${NOT_SAVED}, so it was removed from this device.`
    case 'restored':
      return `Deleting ${what} ${NOT_SAVED}, so it is being restored from your account.`
    default:
      return `Your change to ${what} ${NOT_SAVED}, so it is being changed back to what your account has.`
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
