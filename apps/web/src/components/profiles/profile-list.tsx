import { useEffect, useRef, useState } from 'react'
import type { ClientProfile } from '@/hooks/useActiveProfile'
import {
	useHasMultipleProfiles,
	useProfileError,
	useProfileManager,
	useProfileSwitcher,
	useProfilesWithActive,
} from '@/hooks/useActiveProfile'
import { profileColor, resolveProfileIcon } from '@/lib/profile-appearance'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EditProfileDialog } from './edit-profile'

type ProfileListProps = {
	onCreateNewProfile?: () => void
}

export function ProfileList({ onCreateNewProfile }: ProfileListProps) {
	const { profiles, activeProfileId } = useProfilesWithActive()
	const { deleteProfile } = useProfileManager()
	const { switchToProfile } = useProfileSwitcher()
	const hasMultipleProfiles = useHasMultipleProfiles()
	// Renders the store's refusal channel (e.g. the last-profile refusal), otherwise silent.
	const profileError = useProfileError()
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
	// Owned by the list, not the card: the focus target must outlive the card, which unmounts on confirm.
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
	const headingRef = useRef<HTMLHeadingElement | null>(null)
	// A mutated ref, not a conditional prop: Modal reads finalFocusRef.current in an effect cleanup
	// captured at open. Null on dismissal (focus returns to Delete), the heading on confirm.
	const returnFocusRef = useRef<HTMLElement | null>(null)

	const pendingDeleteProfile = profiles.find((profile) => profile.id === pendingDeleteId) ?? null

	// A pull can tombstone the pending profile; clear the id so a re-delivered row cannot reopen the dialog.
	useEffect(() => {
		if (pendingDeleteId && !pendingDeleteProfile) setPendingDeleteId(null)
	}, [pendingDeleteId, pendingDeleteProfile])

	const handleDelete = async (profileId: string) => {
		if (deletingId) return

		setDeletingId(profileId)

		try {
			// A same-tick double submit is prevented by confirmDelete clearing pendingDeleteId
			// (unmounting the dialog), not by this closure-state check.
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

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between mb-4">
				{/* tabIndex -1 makes the heading a focus target when the confirming card unmounts. */}
				<h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-heading">
					Your Profiles
				</h2>
				<span className="text-sm text-muted">
					{profiles.length} profile{profiles.length !== 1 ? 's' : ''}
				</span>
			</div>

			{/* role=alert so a refusal with no focus change is announced. */}
			{profileError && (
				<p
					role="alert"
					data-testid="profile-error"
					className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
				>
					{profileError}
				</p>
			)}

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

			{/* Irreversible with no undo: the copy must list exactly what the cascade deletes
         (PROFILE_CHILD_TABLES plus saved forecasts). finalFocusRef only on confirm. */}
			<ConfirmDialog
				isOpen={pendingDeleteProfile !== null}
				onConfirm={confirmDelete}
				onCancel={cancelDelete}
				finalFocusRef={returnFocusRef}
				title="Delete profile"
				message={
					pendingDeleteProfile
						? `Delete "${pendingDeleteProfile.name}"? Its income, expenses, savings goals, balances, categories and saved forecasts will be permanently deleted. This can't be undone.`
						: ''
				}
			/>

			{editingProfileId && (
				<EditProfileDialog
					// Keyed so switching straight to another profile's Edit re-seeds the form (Modal does not inert the background).
					key={editingProfileId}
					profileId={editingProfileId}
					onClose={() => setEditingProfileId(null)}
				/>
			)}

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

type ProfileCardProps = {
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
			{/* Stretched link: only the name is the button (role=button strips child roles); its ::after
         overlay covers the card, and the actions row sits above it with z-10. */}
			<div className="flex items-start gap-3 mb-3">
				<div
					className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-xl shrink-0 ${color}`}
				>
					{icon}
				</div>

				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h3 className="font-semibold text-heading truncate">
							<button
								type="button"
								// No handler and no stretch overlay when active: the active card is inert.
								onClick={isActive ? undefined : onSwitch}
								aria-current={isActive ? 'true' : undefined}
								// aria-disabled, not disabled: disabled would drop the active name from the tab order.
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

			{/* relative z-10 lifts this row above the name button's stretched ::after overlay. */}
			<div className="mt-4 pt-4 border-t border-default flex items-center gap-2 relative z-10">
				{/* min-h-[1.75rem] px-2: 28px target floor; a bare text button is only 20px tall. */}
				<button
					type="button"
					onClick={onEdit}
					aria-label={`Edit ${profile.name}`}
					className="text-sm text-accent hover:text-blue-800 dark:hover:text-blue-200 transition-colors inline-flex items-center min-h-[1.75rem] px-2 -ml-2 rounded"
				>
					Edit
				</button>

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
