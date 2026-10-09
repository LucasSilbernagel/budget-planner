import type React from 'react'
import { PRICING_PAGE } from '../../content/legal'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../lib/premium/benefits'
import { MarkdownRenderer } from '../docs/markdown-renderer'
import { Card } from '../ui/Card'
import { Page } from '../ui/Page'
import { PageContent } from '../ui/PageContent'
import { PageDescription } from '../ui/PageDescription'
import { PageHeader } from '../ui/PageHeader'
import { PageTitle } from '../ui/PageTitle'
import { PlanCard } from './plan-card'
import { PremiumCheckoutButton } from './premium-checkout-button'

export function PricingPageView(): React.ReactElement {
	return (
		<Page>
			<PageContent>
				<PageHeader>
					<a href="/" className="text-sm text-accent hover:underline">
						← Back to app
					</a>
					<PageTitle className="mt-2">{PRICING_PAGE.title}</PageTitle>
					<PageDescription>{PRICING_PAGE.description}</PageDescription>
				</PageHeader>

				<main className="space-y-8">
					<section aria-label="Plan comparison" className="grid grid-cols-1 gap-6 md:grid-cols-2">
						<PlanCard
							name="Free"
							price="€0"
							priceSuffix="forever"
							tagline="No account required."
							features={FREE_FEATURES}
							ctaLabel="Start for free"
							ctaHref="/"
							ctaPrimary={false}
						/>
						<PlanCard
							name="Premium"
							price="€39"
							priceSuffix="/ year"
							// Also stated in the legal pricing copy; tests re-derive it from the prices.
							priceNote="or €5.99 / month (annual saves 46%) · €99 once — lifetime license"
							tagline="Everything in Free, plus:"
							features={PREMIUM_FEATURE_LIST}
							ctaLabel="Get Premium"
							ctaPrimary
							ctaElement={<PremiumCheckoutButton />}
							recommended
						/>
					</section>

					<p className="mx-auto max-w-2xl text-balance text-center text-sm text-muted">
						The monthly and annual plans cancel anytime; the lifetime license is a one-time
						purchase. Billed securely by Paddle, our Merchant of Record. Prices shown in EUR; Paddle
						charges the equivalent in your local currency at checkout.
					</p>

					<Card as="section">
						<MarkdownRenderer content={PRICING_PAGE.content} />
					</Card>
				</main>
			</PageContent>
		</Page>
	)
}

const FREE_FEATURES = [
	'Track income, expenses, savings goals, and balances',
	'Net income and savings-capacity calculations',
	'Income-vs-expense and balances breakdown charts',
	'Retirement modelling',
	'Private local storage — your data never leaves your device',
] satisfies readonly string[]

// Claim only what ships: no side-by-side forecast comparison, and categories never sync,
// so the EU-storage line stays on sync only.
export const PREMIUM_FEATURES: Record<PremiumBenefitId, string> = {
	sync: 'Multi-device sync, securely stored in the EU',
	forecasting: 'Advanced forecasting — save, search, and reload what-if scenarios',
	profiles: 'Custom profiles (e.g. personal vs. household)',
	report:
		'Financial summary report — save your budget, net worth and savings as a PDF from your browser',
	categories: 'Custom income and expense categories, with a breakdown of what each one totals',
}

const PREMIUM_FEATURE_LIST: readonly string[] = PREMIUM_BENEFIT_IDS.map(
	(id) => PREMIUM_FEATURES[id]
)
