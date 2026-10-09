import type React from 'react'

export function CrownIcon({ className }: { className: string }): React.ReactElement {
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
				d="M5 18V6a2 2 0 012-2h10a2 2 0 012 2v12M9 18h6M9 18h6M9 18V8m6 10V8m-6 10a2 2 0 002 2h2a2 2 0 002-2M9 18a2 2 0 00-2-2h2a2 2 0 002 2"
			/>
		</svg>
	)
}
