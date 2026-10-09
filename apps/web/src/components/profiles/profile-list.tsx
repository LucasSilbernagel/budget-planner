import { useEffect, useRef, useState } from 'react'
import {
	useProfileManager,
	useProfileSwitcher,
	useProfilesWithActive,
} from '@/hooks/useActiveProfile'
import { profileColor, resolveProfileIcon } from '@/lib/profile-appearance'
import { useHasMultipleProfiles, useProfileError } from '@/stores/profileStore'
import { Card } from '../ui/Card'
import { CardHeader } from '../ui/CardHeader'
import { CardTitle } from '../ui/CardTitle'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EditProfileDialog } from './edit-profile'
import { ProfileCard } from './profile-card'

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
			<CardHeader className="mb-4">
				{/* tabIndex -1 makes the heading a focus target when the confirming card unmounts. */}
				<CardTitle ref={headingRef} tabIndex={-1} className="text-heading">
					Your Profiles
				</CardTitle>
				<span className="text-sm text-muted">
					{profiles.length} profile{profiles.length !== 1 ? 's' : ''}
				</span>
			</CardHeader>

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
				<Card variant="inset" className="mt-6 p-4">
					<p className="text-sm text-body">
						💡 <strong>Tip:</strong> Create additional profiles to organize your finances for
						different purposes (e.g., personal, business, investments).
					</p>
				</Card>
			)}
		</div>
	)
}
