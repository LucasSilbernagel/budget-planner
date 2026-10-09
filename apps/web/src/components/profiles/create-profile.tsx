import { useEffect, useState } from 'react'
import { useProfileManager } from '@/hooks/useActiveProfile'
import { DEFAULT_PROFILE_ICON, isProfileIcon } from '@/lib/profile-appearance'
import { useProfiles } from '@/stores/profileStore'
import { Modal } from '../ui/Modal'
import { EMPTY_PROFILE_FORM, type ProfileFormState, validateProfileForm } from './profile-form'
import { ProfileIconPicker } from './profile-icon-picker'

// Shared by the useState initialiser and the mount-reset effect; resetting to
// EMPTY_PROFILE_FORM (icon '') would drop the 🏠 pre-selection.
const INITIAL_CREATE_FORM = {
	...EMPTY_PROFILE_FORM,
	icon: DEFAULT_PROFILE_ICON,
} satisfies ProfileFormState

type CreateProfileDialogProps = {
	onClose: () => void
}

export function CreateProfileDialog({ onClose }: CreateProfileDialogProps) {
	const [form, setForm] = useState<ProfileFormState>(INITIAL_CREATE_FORM)
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [success, setSuccess] = useState(false)

	const { createProfile } = useProfileManager()
	const profiles = useProfiles()

	useEffect(() => {}, [])

	useEffect(() => {
		setForm(INITIAL_CREATE_FORM)
		setErrors({})
		setSuccess(false)
		setIsSubmitting(false)
	}, [])

	// `null`: a new profile has no id, so every existing name counts.
	const validate = (): boolean => {
		const newErrors = validateProfileForm(form, profiles, null)
		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!validate()) return

		setIsSubmitting(true)

		try {
			const userId = localStorage.getItem('userId') || 'temp-user'

			createProfile({
				...form,
				// Guarded so '' (or any non-member) can never be stored or synced; falls back to 🏠.
				icon: isProfileIcon(form.icon) ? form.icon : DEFAULT_PROFILE_ICON,
				currency: 'NONE',
				userId,
				isDefault: false,
			})

			setSuccess(true)

			setTimeout(() => {
				onClose()
			}, 1500)
		} catch (_error) {
			setErrors({ ...errors, form: 'Failed to create profile. Please try again.' })
		} finally {
			setIsSubmitting(false)
		}
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
			labelledBy="create-profile-title"
			className="bg-white dark:bg-gray-800 dark:text-gray-100 rounded-xl shadow-xl w-full max-w-md"
		>
			<div className="flex items-center justify-between p-6 border-b border-default">
				<div>
					<h2 id="create-profile-title" className="text-xl font-bold text-heading">
						Create New Profile
					</h2>
					<p className="text-body mt-1">Organize your finances for different purposes</p>
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
				{success ? (
					<div className="text-center py-8">
						<svg
							aria-hidden="true"
							className="w-12 h-12 text-green-500 mx-auto mb-4"
							fill="currentColor"
							viewBox="0 0 20 20"
						>
							<path
								fillRule="evenodd"
								d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
								clipRule="evenodd"
							/>
						</svg>
						<h3 className="text-lg font-semibold text-green-800 dark:text-green-300">
							Profile Created!
						</h3>
						<p className="text-green-600 dark:text-green-400 mt-2">
							Your new profile has been created and is ready to use.
						</p>
					</div>
				) : (
					<>
						<ProfileIconPicker
							idPrefix="create-profile"
							value={form.icon}
							onChange={(icon) => handleChange('icon', icon)}
						/>

						<div>
							<label htmlFor="profile-name" className="block text-sm font-medium text-label mb-1">
								Profile Name <span className="text-red-500">*</span>
							</label>
							<input
								id="profile-name"
								type="text"
								value={form.name}
								onChange={(e) => handleChange('name', e.target.value)}
								placeholder="e.g., Personal, Business, Investments"
								maxLength={255}
								className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
									errors['name'] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
								}`}
							/>
							{errors['name'] && (
								<p className="text-sm text-red-600 dark:text-red-400 mt-1">{errors['name']}</p>
							)}
						</div>

						<div>
							<label
								htmlFor="profile-description"
								className="block text-sm font-medium text-label mb-1"
							>
								Description
							</label>
							<textarea
								id="profile-description"
								value={form.description}
								onChange={(e) => handleChange('description', e.target.value)}
								placeholder="Briefly describe the purpose of this profile (optional)"
								maxLength={500}
								rows={3}
								className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 ${
									errors['description'] ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
								}`}
							/>
							<p className="text-xs text-muted mt-1 text-right">
								{form.description.length}/500 characters
							</p>
							{errors['description'] && (
								<p className="text-sm text-red-600 dark:text-red-400 mt-1">
									{errors['description']}
								</p>
							)}
						</div>

						<div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-lg">
							<p className="text-sm text-blue-700 dark:text-blue-300">
								💡 <strong>Note:</strong> This profile will initially contain no financial data. You
								can add income, expenses, and other data after creating it.
							</p>
						</div>

						{errors['form'] && (
							<div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg">
								<p className="text-sm text-red-700 dark:text-red-300">{errors['form']}</p>
							</div>
						)}

						<div className="flex items-center justify-end gap-3 pt-2">
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
								{isSubmitting ? 'Creating...' : 'Create Profile'}
							</button>
						</div>
					</>
				)}
			</form>
		</Modal>
	)
}
