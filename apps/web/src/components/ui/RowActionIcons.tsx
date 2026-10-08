import type React from 'react'

/**
 * Hand-rolled: there is no icon package, and the CSP (`font-src`/`img-src 'self'`) rules out a CDN icon font.
 * `aria-hidden` is the contract: the wrapping button's `aria-label` is the whole accessible name.
 */

/** These SVGs set no width/height, so without a sizing class they fall back to ~300x150. */
const ICON_SIZE = 'h-5 w-5'

/** Heroicons v1 outline `pencil-alt` — the row Edit action. */
export function PencilIcon({ className = ICON_SIZE }: { className?: string }): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
			/>
		</svg>
	)
}

/** Heroicons v1 outline `trash` — the row Delete action. */
export function TrashIcon({ className = ICON_SIZE }: { className?: string }): React.ReactElement {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
			/>
		</svg>
	)
}
