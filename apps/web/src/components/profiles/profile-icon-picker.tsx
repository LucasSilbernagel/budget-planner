import { useRef } from 'react'
import { PROFILE_ICON_LABELS, PROFILE_ICONS, type ProfileIcon } from '@/lib/profile-appearance'

interface ProfileIconPickerProps {
	value: string
	onChange: (icon: ProfileIcon) => void
	idPrefix: string
}

export function ProfileIconPicker({ value, onChange, idPrefix }: ProfileIconPickerProps) {
	const iconRefs = useRef<(HTMLButtonElement | null)[]>([])
	const labelId = `${idPrefix}-icon-label`

	// WAI-ARIA radiogroup contract: arrows wrap and select, Home/End jump. Focus moves
	// explicitly because the roving tabindex leaves other options unfocusable.
	const handleIconKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const count = PROFILE_ICONS.length
		const current = (PROFILE_ICONS as readonly string[]).indexOf(value)
		// -1 for an unrecognised stored icon; start from the first so the keyboard still works.
		const from = current === -1 ? 0 : current

		let next: number
		switch (e.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				next = (from + 1) % count
				break
			case 'ArrowLeft':
			case 'ArrowUp':
				next = (from - 1 + count) % count
				break
			case 'Home':
				next = 0
				break
			case 'End':
				next = count - 1
				break
			default:
				return
		}

		// Only now, once we know the key was ours: an unhandled key must keep its
		// default (Tab must still leave the group, Escape must still close the modal).
		e.preventDefault()
		const icon = PROFILE_ICONS[next]
		if (icon) {
			onChange(icon)
			iconRefs.current[next]?.focus()
		}
	}

	return (
		<div>
			<span id={labelId} className="block text-sm font-medium text-label mb-1">
				Profile Icon
			</span>
			{/* role="radio" obliges the radiogroup keyboard contract (onKeyDown + roving tabindex). */}
			<div
				role="radiogroup"
				aria-labelledby={labelId}
				className="flex flex-wrap gap-2"
				onKeyDown={handleIconKeyDown}
			>
				{PROFILE_ICONS.map((icon, index) => {
					const selected = value === icon
					return (
						// biome-ignore lint/a11y/useSemanticElements: roving-tabindex icon buttons implement the ARIA radio pattern
						<button
							key={icon}
							type="button"
							role="radio"
							aria-checked={selected}
							aria-label={PROFILE_ICON_LABELS[icon]}
							tabIndex={selected ? 0 : -1}
							ref={(el) => {
								iconRefs.current[index] = el
							}}
							onClick={() => onChange(icon)}
							className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
								selected
									? // Selection must not rely on colour alone (WCAG 1.4.1): the border width differs.
										'border-4 border-blue-600 bg-blue-50 dark:border-blue-300 dark:bg-blue-950/40'
									: 'border-2 border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500'
							}`}
						>
							<span aria-hidden="true">{icon}</span>
						</button>
					)
				})}
			</div>
		</div>
	)
}
