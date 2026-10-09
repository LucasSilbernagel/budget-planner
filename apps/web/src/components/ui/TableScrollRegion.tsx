import { type ReactElement, type ReactNode, useRef } from 'react'
import { useHorizontalOverflow } from '../../hooks/useHorizontalOverflow'

/**
 * A Tab stop only while it scrolls: arrow keys are the only pointer-free way to see overflowed figures.
 * Starts focusable so SSR and the first client render agree; an effect drops `tabIndex` when content fits.
 */
export function TableScrollRegion({
	label,
	className,
	children,
}: {
	label: string
	className: string
	children: ReactNode
}): ReactElement {
	const ref = useRef<HTMLDivElement>(null)
	const scrolls = useHorizontalOverflow(ref)
	return (
		// biome-ignore lint/a11y/useSemanticElements: a <section> region would be announced even when it doesn't scroll
		<div
			ref={ref}
			className={className}
			// Keep non-literal: Biome's noNoninteractiveTabindex autofix deletes a literal tabIndex={0}.
			tabIndex={scrolls ? 0 : undefined}
			role="region"
			aria-label={label}
		>
			{children}
		</div>
	)
}
