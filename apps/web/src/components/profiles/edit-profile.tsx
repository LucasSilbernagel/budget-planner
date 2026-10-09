import { useEffect, useState } from 'react'
import { useProfileById, useProfileManager } from '@/hooks/useActiveProfile'
import { cn } from '@/lib/cn'
import { resolveProfileIcon } from '@/lib/profile-appearance'
import { isSyncActive } from '@/lib/sync/syncBridge'
import { useProfiles } from '@/stores/profileStore'
import { FormField } from '../ui/FormField'
import { FormLabel } from '../ui/FormLabel'
import { Modal } from '../ui/Modal'
import { ModalFooter } from '../ui/ModalFooter'
import { ModalTitle } from '../ui/ModalTitle'
import { type ProfileFormState, validateProfileForm } from './profile-form'
import { ProfileIconPicker } from './profile-icon-picker'

type EditProfileDialogProps = {
	profileId: string
	onClose: () => void
}

export function EditProfileDialog({ profileId, onClose }: EditProfileDialogProps) {
	const profile = useProfileById(profileId)
	const profiles = useProfiles()
	const { modifyProfile } = useProfileManager()

	// Captured once at open: a background pull must not overwrite typing, and comparing
	// against the live profile would make an untouched Save write a stale name back.
	const [initialForm] = useState<ProfileFormState>(() => ({
		name: profile?.name ?? '',
		description: profile?.description ?? '',
		// Seeded with the displayed icon (stored or hash fallback), so a non-empty value is not
		// evidence of a choice; handleSubmit sends icon only when it differs.
		icon: profile ? resolveProfileIcon(profile) : '',
	}))
	const [form, setForm] = useState<ProfileFormState>(initialForm)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [isSubmitting, setIsSubmitting] = useState(false)

	// A pull can tombstone the profile under an open dialog; there is nothing left to edit.
	useEffect(() => {
		if (!profile) {
			onClose()
		}
	}, [profile, onClose])

	if (!profile) {
		return null
	}

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		// Checked before validation so a profile whose name already collides (merged duplicates)
		// can still be closed with Save. `icon` must be part of the comparison.
		if (
			form.name === initialForm.name &&
			form.description === initialForm.description &&
			form.icon === initialForm.icon
		) {
			onClose()
			return
		}

		const newErrors = validateProfileForm(form, profiles, profileId)
		setErrors(newErrors)
		if (Object.keys(newErrors).length > 0) return

		// The bootstrap profile (userId '') is unknown to the server: an update is rejected
		// and the next pull drops it, so the edit would vanish.
		if (profile.userId === '' && isSyncActive()) {
			setErrors({ form: 'This profile is still syncing. Please try again in a moment.' })
			return
		}

		setIsSubmitting(true)
		try {
			// A cleared description stays '' (undefined is dropped from the payload, keeping the old server value).
			// `icon` only when changed, so a never-chosen profile does not get its hash fallback stored as a choice.
			const updates: { name: string; description: string; icon?: string } = {
				name: form.name,
				description: form.description,
			}
			if (form.icon !== initialForm.icon) {
				updates.icon = form.icon
			}
			modifyProfile(profileId, updates)
		} catch (_error) {
			setErrors({ form: 'Failed to save profile. Please try again.' })
			setIsSubmitting(false)
			return
		}
		// Outside the try: a throw from the parent's close handler is not a failed save.
		onClose()
	}

	const handleChange = (field: keyof ProfileFormState, value: string) => {
		setForm({ ...form, [field]: value })

		if (errors[field]) {
			setErrors({ ...errors, [field]: '' })
		}
	}

	return (
		<Modal
			isOpen
			onClose={onClose}
			labelledBy="edit-profile-title"
			className="bg-white dark:bg-gray-800 dark:text-gray-100 rounded-xl shadow-xl w-full max-w-md"
		>
			<div className="flex items-center justify-between p-6 border-b border-default">
				<div>
					<ModalTitle as="h2" id="edit-profile-title" className="text-xl font-bold">
						Edit Profile
					</ModalTitle>
					<p className="text-body mt-1">Update this profile's name or description</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
					aria-label="Close"
				>
					<svg
						aria-hidden="true"
						className="w-6 h-6"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<form onSubmit={handleSubmit} className="p-6 space-y-4">
				<ProfileIconPicker
					idPrefix="edit-profile"
					value={form.icon}
					onChange={(icon) => handleChange('icon', icon)}
				/>

				<FormField>
					<FormLabel htmlFor="edit-profile-name">
						Profile Name <span className="text-red-500">*</span>
					</FormLabel>
					<input
						id="edit-profile-name"
						type="text"
						value={form.name}
						onChange={(e) => handleChange('name', e.target.value)}
						placeholder="e.g., Personal, Business, Investments"
						maxLength={255}
						className={cn(
							'w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400',
							errors['name'] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
						)}
					/>
					{errors['name'] && (
						<p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors['name']}</p>
					)}
				</FormField>

				<FormField>
					<FormLabel htmlFor="edit-profile-description">Description</FormLabel>
					<textarea
						id="edit-profile-description"
						value={form.description}
						onChange={(e) => handleChange('description', e.target.value)}
						placeholder="Briefly describe the purpose of this profile (optional)"
						maxLength={500}
						rows={3}
						className={cn(
							'w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400',
							errors['description'] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
						)}
					/>
					<p className="text-xs text-muted mt-1 text-right">
						{form.description.length}/500 characters
					</p>
					{errors['description'] && (
						<p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors['description']}</p>
					)}
				</FormField>

				{errors['form'] && (
					<div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg">
						<p className="text-sm text-red-700 dark:text-red-300">{errors['form']}</p>
					</div>
				)}

				<ModalFooter className="items-center pt-2">
					<button
						type="button"
						onClick={onClose}
						className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={isSubmitting}
						className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
					>
						{isSubmitting ? 'Saving...' : 'Save Changes'}
					</button>
				</ModalFooter>
			</form>
		</Modal>
	)
}
