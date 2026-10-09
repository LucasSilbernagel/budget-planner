import { Link } from '@tanstack/react-router'

// Links match by PREFIX (the router's segment-aware default). Don't hand-roll
// `startsWith`: it would also match `/docsomething`.

type FooterPath = '/pricing' | '/docs' | '/terms' | '/privacy' | '/refund' | '/contact'

type FooterLink = {
	label: string
	to: FooterPath
}

const FOOTER_LINKS = [
	{ label: 'Pricing', to: '/pricing' },
	{ label: 'Documentation', to: '/docs' },
	{ label: 'Terms of Service', to: '/terms' },
	{ label: 'Privacy Policy', to: '/privacy' },
	{ label: 'Refund Policy', to: '/refund' },
	{ label: 'Contact', to: '/contact' },
] satisfies readonly FooterLink[]

// An inline `<a>` ignores min-height; as a grid item it is blockified.
const LINK_CLASS =
	'text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 max-sm:flex max-sm:min-h-[44px] max-sm:items-center max-sm:justify-center'

// `green` beats the base `gray` by CSS source order, not class order; an
// intra-gray override would not reliably win in dark mode.
const ACTIVE_LINK_CLASS =
	'font-medium text-green-700 no-underline hover:text-green-800 dark:text-green-400 dark:hover:text-green-300'

export function Footer() {
	return (
		// Not a `footer` tag selector in print CSS: `<footer>` is also used for in-page content.
		<footer
			data-print-hide
			className="mt-auto border-t border-gray-200 py-3 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400"
		>
			<div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap sm:gap-x-3 sm:gap-y-1">
				<span>Longhand Budget</span>
				{/* `w-full`: the outer column is `items-center` and would shrink the grid. */}
				<div className="grid w-full grid-cols-2 gap-x-2 sm:contents">
					{FOOTER_LINKS.map((link) => (
						<Link
							key={link.to}
							to={link.to}
							className={LINK_CLASS}
							activeProps={{ 'aria-current': 'page', className: ACTIVE_LINK_CLASS }}
						>
							{link.label}
						</Link>
					))}
				</div>
				{/* suppressHydrationWarning: SSR and hydration can straddle New Year. */}
				<span className="mt-2 sm:ml-3 sm:mt-0" suppressHydrationWarning>
					Copyright {new Date().getFullYear()}{' '}
					<a
						href="https://lucassilbernagel.com/"
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Lucas Silbernagel's website (opens in a new tab)"
						className="text-gray-500 underline hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 max-sm:inline-flex max-sm:min-h-[44px] max-sm:items-center"
					>
						Lucas Silbernagel
					</a>
				</span>
			</div>
		</footer>
	)
}
