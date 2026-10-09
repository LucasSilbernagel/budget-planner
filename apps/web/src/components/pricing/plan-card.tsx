import type React from 'react'
import { cn } from '@/lib/cn'
import { CheckIcon } from '../icons/CheckIcon'
import { Card } from '../ui/Card'
import { CardTitle } from '../ui/CardTitle'

type PlanCardCta =
	| { ctaHref: string; ctaElement?: undefined }
	| { ctaHref?: undefined; ctaElement: React.ReactNode }

type PlanCardProps = {
	name: string
	price: string
	priceSuffix: string
	priceNote?: string
	tagline: string
	features: readonly string[]
	ctaLabel: string
	ctaPrimary: boolean
	recommended?: boolean
} & PlanCardCta

export function PlanCard({
	name,
	price,
	priceSuffix,
	priceNote,
	tagline,
	features,
	ctaLabel,
	ctaHref,
	ctaPrimary,
	ctaElement,
	recommended = false,
}: PlanCardProps): React.ReactElement {
	return (
		<Card
			className={cn(
				'relative flex flex-col rounded-2xl border',
				recommended
					? // A 500-weight ring reads hot on a gray-800 card, so dark drops to 400.
						'border-blue-500 ring-1 ring-blue-500 dark:border-blue-400 dark:ring-blue-400'
					: 'border-default'
			)}
		>
			{recommended && (
				// Not tokenised: the pill straddles card and canvas; blue-600 reads on both in both themes.
				<span className="absolute -top-3 left-6 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-semibold text-white">
					Recommended
				</span>
			)}
			<CardTitle className="text-heading">{name}</CardTitle>
			<div className="mt-2 flex items-baseline gap-1">
				<span className="text-4xl font-bold text-heading">{price}</span>
				<span className="text-sm text-muted">{priceSuffix}</span>
			</div>
			<p className="mt-1 min-h-[1.25rem] text-sm text-muted">{priceNote ?? ''}</p>
			<p className="mt-3 text-sm font-medium text-label">{tagline}</p>
			<ul className="mt-4 flex-1 space-y-2">
				{features.map((feature) => (
					<li key={feature} className="flex items-start gap-2 text-sm text-body">
						<CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
						<span>{feature}</span>
					</li>
				))}
			</ul>
			{ctaElement ?? (
				<a
					href={ctaHref}
					// The ring offset defaults to white: without this a focused CTA shows a white band on the dark card.
					className={cn(
						'mt-6 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800',
						ctaPrimary
							? // blue-600 in both themes: white on blue-500 is 3.68:1, below WCAG AA.
								'bg-blue-600 text-white hover:bg-blue-700'
							: // gray-700, not gray-800: this sits on a gray-800 card and would vanish.
								'border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
					)}
				>
					{ctaLabel}
				</a>
			)}
		</Card>
	)
}
