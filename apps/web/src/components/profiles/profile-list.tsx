/**
 * Profile List Component
 *
 * Displays a list of user profiles with options to manage them.
 * Each card IS the profile switcher (story 63.1, FR96): its header is a real
 * activation `<button>`, with Edit/Delete as SIBLINGS of that button rather than
 * children, so the card is switchable without nesting interactive content.
 *
 * ⚠️ This REVERSES story 54.3 (FR80), which removed the per-card "Switch to" and
 * made `SwitchProfileDropdown` the one switcher. That component is deleted as of
 * 63.1. FR80's "exactly one control lets a user switch the active profile" clause
 * is UNCHANGED and still holds — the card is now that control.
 *
 * Architecture: React with Tailwind CSS
 * State Management: Zustand via useActiveProfile hook
 */

import {
  useHasMultipleProfiles,
  useProfileManager,
  useProfileSwitcher,
  useProfilesWithActive,
} from '@/hooks/useActiveProfile'
import type { ClientProfile } from '@/hooks/useActiveProfile'
import { profileColor, resolveProfileIcon } from '@/lib/profile-appearance'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EditProfileDialog } from './edit-profile'

// ⚠️ No `formatDate` and no `canonicalizeCurrency` import since story 54.5
// (UX-DR60): the card's "Currency:" and "Created:" meta rows were its only
// callers, so both became dead the moment those rows went. `canonicalizeCurrency`
// itself lives on — `stores/profileStore.ts` and `stores/currencyStore.ts` still
// use it, and `packages/core/src/format/__tests__/currency.test.ts` still proves
// the CAD/AUD/MXN -> USD consolidation directly. Only this file's import is gone.

interface ProfileListProps {
  onCreateNewProfile?: () => void
}

export function ProfileList({ onCreateNewProfile }: ProfileListProps) {
  const { profiles, activeProfileId } = useProfilesWithActive()
  const { deleteProfile } = useProfileManager()
  // ⚠️ The SAME call the deleted `SwitchProfileDropdown` made (story 63.1 AC-5).
  // This story changes only which element invokes it — not the switch semantics,
  // the store write or the sync-bridge behaviour downstream of it.
  const { switchToProfile } = useProfileSwitcher()
  const hasMultipleProfiles = useHasMultipleProfiles()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // The profile whose Edit dialog is open (story 54.1) — any profile, not only the active one.
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  // The profile awaiting delete confirmation (story 63.2, FR97). The dialog is
  // owned by the LIST, not by each card: it needs a focus target that outlives
  // the card, and the card unmounts on confirm.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  // Where focus goes when the confirmation closes.
  //
  // ⚠️⚠️ A STABLE REF WHOSE `.current` IS MUTATED, and the shape is the whole
  // point (code review). `Modal`'s restore is
  // `finalFocusRef?.current ?? previouslyFocused`, read in an effect CLEANUP
  // that closes over the props from the render in which the effect last ran —
  // i.e. when the dialog OPENED. So passing `finalFocusRef` conditionally at
  // close time is too late: the cleanup still sees whatever was passed at open.
  // `.current`, by contrast, is dereferenced during the cleanup itself.
  //
  // Null on dismissal, so `Modal` falls back to its default and returns focus to
  // the Delete button the user pressed — it is still mounted, and it is where
  // they were. The heading only on confirm, where that button unmounts with its
  // card and the default target would be detached.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const pendingDeleteProfile = profiles.find((profile) => profile.id === pendingDeleteId) ?? null

  // ⚠️ A pull can tombstone the pending profile while its dialog is open (code
  // review). `isOpen` then flips false on its own, but `pendingDeleteId` would
  // stay set — and if that id were ever re-delivered by a later pull the dialog
  // would REOPEN with no user action. Clear it when its profile goes.
  useEffect(() => {
    if (pendingDeleteId && !pendingDeleteProfile) setPendingDeleteId(null)
  }, [pendingDeleteId, pendingDeleteProfile])

  // Handle profile deletion
  const handleDelete = async (profileId: string) => {
    if (deletingId) return // Prevent multiple simultaneous deletions

    setDeletingId(profileId)

    try {
      // ⚠️ `deleteProfile` resolves to the store's SYNCHRONOUS `removeProfile`
      // (`useActiveProfile.ts:182-184`), so this `await` settles immediately and
      // `deletingId` never represents an in-flight server call — the sync push is
      // fire-and-forget behind `syncEntityDelete`.
      //
      // ⚠️ This `if` does NOT prevent a same-tick double submit, and an earlier
      // version of this comment claimed it did (code review). `deletingId` is
      // closure state: it cannot change between two calls in one tick, only on
      // the next render. What actually prevents a second confirm is that
      // `confirmDelete` clears `pendingDeleteId` first, which unmounts the
      // dialog before its button can be pressed again.
      await deleteProfile(profileId)
    } finally {
      setDeletingId(null)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDeleteId) return
    const profileId = pendingDeleteId
    returnFocusRef.current = headingRef.current
    setPendingDeleteId(null)
    await handleDelete(profileId)
  }

  const cancelDelete = () => {
    returnFocusRef.current = null
    setPendingDeleteId(null)
  }

  // Get color for a profile (consistent based on ID hash)

  // Get icon for a profile (consistent based on ID hash)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        {/* ⚠️ `tabIndex={-1}` is what makes this a usable `finalFocusRef`: the
            confirming Delete button unmounts with its card, so Modal's default
            focus-restore would land on a detached node and focus would fall to
            `<body>`. A heading is only programmatically focusable. */}
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-heading">
          Your Profiles
        </h2>
        <span className="text-sm text-muted">
          {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted mb-4">No profiles yet</p>
          <button
            type="button"
            onClick={onCreateNewProfile ? onCreateNewProfile : () => {}}
            disabled={!onCreateNewProfile}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Your First Profile
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              isActive={profile.id === activeProfileId}
              isDeleting={deletingId === profile.id}
              onDelete={() => setPendingDeleteId(profile.id)}
              onEdit={() => setEditingProfileId(profile.id)}
              onSwitch={() => switchToProfile(profile.id)}
              color={profileColor(profile.id)}
              icon={resolveProfileIcon(profile)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation (story 63.2, FR97). Before this, `handleDelete` ran
          straight off the click — a single stray press destroyed a profile.

          ⚠️⚠️ THE WORDING PROMISES ONLY WHAT THE CODE DOES, and an earlier
          version did not (code review). It said "and its data", justified by the
          foreign-key failure in `server/functions/profiles.ts` — but that
          function has ZERO callers, so its FK error can never reach a user. On
          the path a deletion actually takes, NOTHING deletes the profile's
          financial rows: `removeProfile` touches only `profileStore`, the sync
          push tombstones only the profile row, and no other store is cleaned.
          The rows stay live on every device, merely unreachable. So the message
          says the entries stop being VISIBLE, which is true, instead of claiming
          a destruction that does not happen. The orphaning is logged in
          `deferred-work.md`; story 63.2 made it the common case by making the
          original profile deletable.

          ⚠️ `finalFocusRef` is passed ONLY when the user confirmed. `Modal`
          honours it on EVERY close (`Modal.tsx`: `finalFocusRef?.current ??
          previouslyFocused`), so passing it unconditionally sent a Cancel or
          Escape to the page heading — losing a keyboard user's place among the
          cards, when their Delete button was still mounted and is the correct
          return target. It is needed only on confirm, where the card unmounts
          and the default restore target would be detached. */}
      <ConfirmDialog
        isOpen={pendingDeleteProfile !== null}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        finalFocusRef={returnFocusRef}
        title="Delete profile"
        message={
          pendingDeleteProfile
            ? `Delete "${pendingDeleteProfile.name}"? Its entries will no longer be visible. This can't be undone.`
            : ''
        }
      />

      {editingProfileId && (
        <EditProfileDialog
          // Keyed so switching straight from one profile to another re-seeds the
          // form. `Modal` does not inert the background, so another card's Edit
          // stays reachable while a dialog is open (code review 54.1).
          key={editingProfileId}
          profileId={editingProfileId}
          onClose={() => setEditingProfileId(null)}
        />
      )}

      {/* Multiple profiles notice */}
      {!hasMultipleProfiles && (
        <div className="mt-6 p-4 surface-inset rounded-lg">
          <p className="text-sm text-body">
            💡 <strong>Tip:</strong> Create additional profiles to organize your finances for
            different purposes (e.g., personal, business, investments).
          </p>
        </div>
      )}
    </div>
  )
}

// Individual profile card component
interface ProfileCardProps {
  profile: ClientProfile
  isActive: boolean
  isDeleting: boolean
  onDelete: () => void
  onEdit: () => void
  onSwitch: () => void
  color: string
  icon: string
}

function ProfileCard({
  profile,
  isActive,
  isDeleting,
  onDelete,
  onEdit,
  onSwitch,
  color,
  icon,
}: ProfileCardProps) {
  const hasMultipleProfiles = useHasMultipleProfiles()

  return (
    <div
      className={`surface border rounded-xl p-5 transition-all duration-200 relative ${
        isActive
          ? 'border-blue-500 shadow-lg shadow-blue-500/10'
          : 'border-default hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      {/* Profile header (story 63.1, FR96).
          ⚠️⚠️ STRETCHED LINK, and the structure is the whole point — chosen in
          code review after TWO review layers independently found that the first
          implementation destroyed this card's accessibility tree.
          That version made the entire header one big `<button aria-label=…>`.
          ARIA's `button` role is CHILDREN-PRESENTATIONAL: every descendant's role
          is stripped, so the `<h3>` vanished from heading navigation and the
          "Default" badge and the description were announced NOWHERE on the page —
          they appear in no other surface. Neither jsdom (testing-library does not
          model presentational children) nor Playwright can see that, which is why
          it took a human-shaped review rather than a failing test.
          Now only the NAME is the control. The heading, badge and description are
          real content again, outside the button, and `after:absolute after:inset-0`
          stretches the button's hit area over the whole card — so FR96's "the
          whole card, not a button on it" still holds for a pointer.
          ⚠️ The card is `relative` so that overlay resolves against IT. The actions
          row below is `relative z-10` to sit ABOVE the overlay; without that the
          overlay would swallow Edit and Delete. Hit-tested in the e2e, not assumed.
          ⚠️ The old geometric non-overlap assertion is gone on purpose: here the
          activation area overlaps the actions BY DESIGN, and z-order decides. The
          e2e asks `elementFromPoint` what a tap actually lands on instead. */}
      <div className="flex items-start gap-3 mb-3">
        {/* Profile icon */}
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xl shrink-0 ${color}`}
        >
          {icon}
        </div>

        {/* Profile info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-heading truncate">
              <button
                type="button"
                // ⚠️ AC-3: the active card is not activatable TO ITSELF. No handler
                // at all when active, rather than a handler that returns early —
                // there is no silent no-op to mistake for a broken switch. The
                // active card also gets NO stretch overlay, so its whole card is
                // inert rather than being a card-sized target that does nothing.
                onClick={isActive ? undefined : onSwitch}
                aria-current={isActive ? 'true' : undefined}
                // ⚠️ `aria-disabled`, NOT `disabled`. A `disabled` button leaves
                // the tab order, and this control IS the profile's name — so
                // `disabled` would make the one card a keyboard user most wants to
                // confirm the only one they cannot reach.
                aria-disabled={isActive ? 'true' : undefined}
                aria-label={
                  isActive ? `${profile.name} (current profile)` : `Switch to ${profile.name}`
                }
                className={`max-w-full truncate text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  isActive
                    ? 'cursor-default'
                    : "cursor-pointer after:absolute after:inset-0 after:content-['']"
                }`}
              >
                {profile.name}
              </button>
            </h3>
            {profile.isDefault && (
              <span className="text-xs surface-inset text-body px-2 py-0.5 rounded-full">
                Default
              </span>
            )}
          </div>
          <p className="text-sm text-muted truncate">{profile.description || 'No description'}</p>
        </div>
      </div>

      {/* No "Currency:" / "Created:" meta rows since story 54.5 (UX-DR60). Neither
          told the user anything actionable: a profile's currency is not read for
          display formatting anywhere (story 54.1 checked, which is why the create
          and edit dialogs dropped the field), and its creation date never drove a
          decision. The card is name, description, status and actions. */}

      {/* Active indicator */}
      {isActive && (
        <div className="mt-4 flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <svg aria-hidden="true" className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span>Active Profile</span>
        </div>
      )}

      {/* Actions — Edit/Delete, SIBLINGS of the activation region above and never
          nested inside it (story 63.1). That is what lets both stay independently
          operable by mouse and keyboard while the card itself switches. */}
      {/* ⚠️ `relative z-10` lifts this row ABOVE the name button's stretched
          `::after` overlay. Without it the overlay covers Edit and Delete and
          every click on them switches profile instead. The e2e hit-tests this
          rather than inferring it from the class. */}
      <div className="mt-4 pt-4 border-t border-default flex items-center gap-2 relative z-10">
        {/* Edit button - every profile, including the default and a lone one (story 54.1).
            The profile's name is in the accessible name so several cards' Edit
            buttons are distinguishable; the visible "Edit" is contained in it. */}
        {/* ⚠️ `min-h-[1.75rem] px-2 inline-flex items-center` is the project's
            28px target floor (the same recipe as `auth-indicator.tsx:393`), and
            story 63.1 MEASURED that this button did not clear it: a bare text
            button is 20px tall at every width, under both the project floor and
            WCAG 2.2 SC 2.5.8's 24x24. It was under it before this story too —
            the card becoming a control is simply what put a real bounding-box
            measurement on it for the first time.
            ⚠️ `items-center` VERTICALLY CENTRES the label in the 28px box; it is
            NOT what creates the box. An earlier version of this comment claimed
            `inline-flex` was load-bearing because "`min-h` alone on an inline box
            does not make a box" — that was FALSE and the code review caught it. A
            `<button>` is inline-BLOCK by UA default (Tailwind preflight does not
            change its `display`), so `min-height` applies with or without it:
            measured by dropping `inline-flex items-center` and re-running the
            320px/1280px e2e floor assertions, which still passed. */}
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${profile.name}`}
          className="text-sm text-accent hover:text-blue-800 dark:hover:text-blue-200 transition-colors inline-flex items-center min-h-[1.75rem] px-2 -ml-2 rounded"
        >
          Edit
        </button>

        {/* Delete button — every profile except the last one (story 63.2, FR97).
            ⚠️ The `!profile.isDefault` clause that stood here is GONE: a user
            could not delete their original profile and the UI gave no reason,
            because the store's refusal is silent (nothing renders
            `useProfileError`). The default is now deletable and a survivor is
            promoted in `removeProfile`; only the LAST profile is withheld, which
            `hasMultipleProfiles` expresses and the store still enforces.
            ⚠️ The accessible name carries the profile's name, like Edit's. It has
            to: several cards now show Delete, and a screen-reader user hearing
            "Delete, Delete, Delete" cannot tell which is which. Absence probes
            must therefore match `/^Delete /`, never the exact string 'Delete'. */}
        {hasMultipleProfiles && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${profile.name}`}
            disabled={isDeleting}
            className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto inline-flex items-center min-h-[1.75rem] px-2 -mr-2 rounded"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  )
}
