import { cn } from '@/lib/cn'
import { COMPARE_PAGES } from '../../content/compare'

// `undefined` means the hub itself is the page; `null` means no listed page is (the 404).
export type CompareSidebarProps = {
	activeSlug?: string | null
}

const LINK_CLASS = 'block rounded-md px-3 py-2 text-sm transition-colors'
// No semantic token exists for the active pill or inactive hover, hence the hand-rolled dark: variants.
const ACTIVE_CLASS = 'bg-blue-50 dark:bg-blue-950/40 font-medium text-accent'
const INACTIVE_CLASS = 'text-label hover:bg-gray-100 dark:hover:bg-gray-700/40'

export function CompareSidebar({ activeSlug }: CompareSidebarProps) {
	const hubActive = activeSlug === undefined
	return (
		<nav aria-label="Comparisons" className="sm:sticky sm:top-8">
			<h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Comparisons</h2>
			<ul className="space-y-1">
				<li>
					<a
						href="/compare"
						aria-current={hubActive ? 'page' : undefined}
						className={cn(LINK_CLASS, hubActive ? ACTIVE_CLASS : INACTIVE_CLASS)}
					>
						All comparisons
					</a>
				</li>
				{COMPARE_PAGES.map((page) => {
					const isActive = page.slug === activeSlug
					return (
						<li key={page.slug}>
							<a
								href={`/compare/${page.slug}`}
								aria-current={isActive ? 'page' : undefined}
								className={cn(LINK_CLASS, isActive ? ACTIVE_CLASS : INACTIVE_CLASS)}
							>
								{page.title}
							</a>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}
