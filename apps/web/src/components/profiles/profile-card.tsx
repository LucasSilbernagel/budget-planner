import { cn } from '@/lib/cn'
import type { ClientProfile } from '@/stores/profileStore'
import { useHasMultipleProfiles } from '@/stores/profileStore'

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

export function ProfileCard({
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
			className={cn(
				'surface border rounded-xl p-5 transition-all duration-200 relative',
				isActive
					? 'border-blue-500 shadow-lg shadow-blue-500/10'
					: 'border-default hover:border-gray-300 dark:hover:border-gray-600'
			)}
		>
			{/* Stretched link: only the name is the button (role=button strips child roles); its ::after
         overlay covers the card, and the actions row sits above it with z-10. */}
			<div className="flex items-start gap-3 mb-3">
				<div
					className={cn(
						'w-10 h-10 rounded-full flex items-center justify-center text-white text-xl shrink-0',
						color
					)}
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
								className={cn(
									'max-w-full truncate text-left rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
									isActive
										? 'cursor-default'
										: "cursor-pointer after:absolute after:inset-0 after:content-['']"
								)}
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
