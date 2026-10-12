import { COMPARE_PAGES, type ComparePage, TRADEMARK_LINE } from '../../content/compare'
import { MarkdownRenderer } from '../docs/markdown-renderer'
import { ComparisonTable } from './comparison-table'

export type ComparePageBodyProps = {
	page: ComparePage
}

const VERIFIED_FORMAT = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC',
})

const SECTION_CLASS = 'rounded-lg surface p-6 shadow-md'
const HEADING_CLASS = 'mb-3 text-xl font-semibold text-subheading'
const LIST_CLASS = 'list-disc space-y-2 pl-5 text-body'

type SiblingLink = { href: string; label: string }

// With fewer than two other spokes the slots fall back, so every page still links onward.
export function siblingLinks(
	current: ComparePage,
	pages: readonly ComparePage[] = COMPARE_PAGES
): SiblingLink[] {
	const others = pages
		.filter((p) => p.slug !== current.slug)
		.slice(0, 2)
		.map((p) => ({ href: `/compare/${p.slug}`, label: p.title }))
	const fallbacks: SiblingLink[] = [
		{ href: '/compare', label: 'All comparisons' },
		{ href: '/docs/features', label: 'Why Longhand Budget has no bank sync' },
	]
	return [...others, ...fallbacks].slice(0, 2)
}

function formatVerifiedOn(verifiedOn: string): string {
	const date = new Date(`${verifiedOn}T00:00:00Z`)
	return Number.isNaN(date.getTime()) ? verifiedOn : VERIFIED_FORMAT.format(date)
}

export function ComparePageBody({ page }: ComparePageBodyProps) {
	const verified = formatVerifiedOn(page.verifiedOn)
	return (
		<div className="space-y-6">
			<section className={SECTION_CLASS} aria-labelledby="compare-verdict">
				<h2 id="compare-verdict" className={HEADING_CLASS}>
					The short answer
				</h2>
				<p className="text-body">{page.verdict}</p>
				<p className="mt-3 text-sm text-muted">
					Last verified <time dateTime={page.verifiedOn}>{verified}</time>, against{' '}
					<a
						href={page.competitorPricingUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent underline"
					>
						{page.competitorPricingLabel} (opens in a new tab)
					</a>
					.
				</p>
			</section>

			{page.body.trim() ? (
				<section className={SECTION_CLASS}>
					<MarkdownRenderer content={page.body} />
				</section>
			) : null}

			<section className={SECTION_CLASS} aria-labelledby="compare-table">
				<h2 id="compare-table" className={HEADING_CLASS}>
					Side by side
				</h2>
				<ComparisonTable page={page} />
			</section>

			<section className={SECTION_CLASS} aria-labelledby="compare-competitor-better">
				<h2 id="compare-competitor-better" className={HEADING_CLASS}>
					Where {page.competitorName} is better
				</h2>
				<ul className={LIST_CLASS}>
					{page.competitorBetter.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			</section>

			<section className={SECTION_CLASS} aria-labelledby="compare-longhand-better">
				<h2 id="compare-longhand-better" className={HEADING_CLASS}>
					Where Longhand Budget is better
				</h2>
				<ul className={LIST_CLASS}>
					{page.longhandBetter.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			</section>

			<section className={SECTION_CLASS} aria-labelledby="compare-switching">
				<h2 id="compare-switching" className={HEADING_CLASS}>
					Switching
				</h2>
				<p className="text-body">{page.switching}</p>
			</section>

			<section className={SECTION_CLASS} aria-labelledby="compare-faq">
				<h2 id="compare-faq" className={HEADING_CLASS}>
					FAQ
				</h2>
				<div className="space-y-4">
					{page.faq.map((entry) => (
						<div key={entry.q}>
							<h3 className="font-medium text-subheading">{entry.q}</h3>
							<p className="mt-1 text-body">{entry.a}</p>
						</div>
					))}
				</div>
			</section>

			<section className={SECTION_CLASS} aria-labelledby="compare-more">
				<h2 id="compare-more" className={HEADING_CLASS}>
					Keep reading
				</h2>
				<ul className={LIST_CLASS}>
					{siblingLinks(page).map((link) => (
						<li key={`${link.href}-${link.label}`}>
							<a href={link.href} className="text-accent underline">
								{link.label}
							</a>
						</li>
					))}
					<li>
						<a href="/pricing" className="text-accent underline">
							Longhand Budget pricing
						</a>
					</li>
					<li>
						<a href="/privacy" className="text-accent underline">
							Longhand Budget privacy policy
						</a>
					</li>
				</ul>
				<h3 className="mt-6 text-sm font-medium text-subheading">Sources</h3>
				<ul className="mt-2 space-y-1 text-sm text-body">
					{page.sources.map((source) => (
						<li key={source.url}>
							<a
								href={source.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-accent underline"
							>
								{source.label} (opens in a new tab)
							</a>
						</li>
					))}
				</ul>
				<p className="mt-6 text-xs text-muted">{TRADEMARK_LINE}</p>
			</section>
		</div>
	)
}
