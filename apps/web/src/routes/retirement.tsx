import { createFileRoute } from '@tanstack/react-router'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { RetirementAccumulationPlanner } from '../components/RetirementAccumulationPlanner'
import { RetirementDisabledNotice } from '../components/retirement/RetirementDisabledNotice'
import { Card } from '../components/ui/Card'
import { CardTitle } from '../components/ui/CardTitle'
import { PageContent } from '../components/ui/PageContent'
import { PageHeader } from '../components/ui/PageHeader'
import { PageTitle } from '../components/ui/PageTitle'
import { useShowRetirementPlanner } from '../stores/plannerVisibilityStore'

export const Route = createFileRoute('/retirement')({
	head: () => ({
		meta: [
			{ title: 'Retirement · Longhand Budget' },
			{
				name: 'description',
				content:
					'Plan your retirement from figures you have already entered, and see what your savings will support.',
			},
		],
	}),
	component: RetirementPage,
})

function RetirementPage() {
	// Gates content rather than redirecting, deliberately. A saved plan lands after hydration,
	// so defaults paint first; accepted product decision, do not add a skeleton.
	const showRetirementPlanner = useShowRetirementPlanner()

	if (!showRetirementPlanner) {
		return (
			<ErrorBoundary>
				<RetirementDisabledNotice />
			</ErrorBoundary>
		)
	}

	return (
		<ErrorBoundary>
			<main className="min-h-screen surface-sunken py-6 sm:py-12 px-4 sm:px-6 lg:px-8">
				<PageContent className="max-w-6xl">
					<PageHeader className="sm:mb-12">
						<div>
							<PageTitle className="text-2xl sm:text-4xl mb-3 sm:mb-4">
								Retirement Planner
							</PageTitle>
							<p className="text-base sm:text-xl text-body">
								Your savings figures come from what you have already entered elsewhere. Add a few
								details about your plan to see when you can retire, how big your nest egg needs to
								be, and how your savings grow along the way.
							</p>
						</div>
					</PageHeader>

					<Card as="section" className="mb-8 sm:mb-12 rounded-2xl shadow-lg p-4 sm:p-6 lg:p-8">
						<CardTitle className="text-xl sm:text-2xl mb-2">When Can You Retire?</CardTitle>
						<p className="text-body mb-8">
							Choose whether you want to draw your savings down to zero by your life expectancy or
							live off the returns forever — the target nest egg changes, your inputs don&rsquo;t.
						</p>

						<RetirementAccumulationPlanner />
					</Card>

					<Card className="rounded-2xl shadow-lg p-4 sm:p-6 lg:p-8">
						<CardTitle className="text-xl sm:text-2xl mb-6">
							Understanding Your Retirement Numbers
						</CardTitle>

						<Card variant="inset" className="p-4">
							<h3 className="font-semibold text-subheading mb-2">
								How the Safe Withdrawal Model works
							</h3>
							<p className="text-sm text-body">
								The <strong>Safe Withdrawal Model</strong> — the perpetual target above — sizes your
								nest egg so you can live on the returns alone:
							</p>
							<p className="text-sm text-body mt-2">
								<code className="inline-block break-words bg-gray-200 dark:bg-gray-700 dark:text-gray-100 px-2 py-1 rounded">
									FV = Ir × (12 / r)
								</code>
							</p>
							<ul className="text-sm text-body mt-2 space-y-1">
								<li>
									<strong>FV</strong> = Future Value (required retirement assets)
								</li>
								<li>
									<strong>Ir</strong> = Desired monthly retirement income
								</li>
								<li>
									<strong>r</strong> = Post-retirement annual return rate (as decimal) — the rate
									your savings earn once you are drawing on them, not the one you earn while saving
								</li>
							</ul>
							<p className="text-xs text-muted mt-2">
								Withdraw only what your investments earn and the principal is never touched, so it
								theoretically lasts forever.
							</p>
						</Card>

						<div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/40 rounded-lg">
							<h3 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">
								About the Projection
							</h3>
							<p className="text-sm text-blue-600 dark:text-blue-300">
								The growth chart compounds your savings monthly — the same math behind your earliest
								retirement age, so the two can never disagree. It runs from today up to the year you
								can retire, and assumes:
							</p>
							<ul className="text-sm text-blue-600 dark:text-blue-300 mt-2 space-y-1">
								<li>A consistent return rate while you are saving</li>
								<li>Monthly compounding of returns</li>
								<li>Your monthly savings continue unchanged until retirement</li>
								<li>No withdrawals along the way</li>
							</ul>
						</div>

						<p className="text-sm text-body mt-6">
							<strong>Note:</strong> This is a simplified model and doesn&rsquo;t account for
							inflation, taxes, market volatility, or changes in spending needs. For comprehensive
							retirement planning, consult with a financial advisor.
						</p>
					</Card>
				</PageContent>
			</main>
		</ErrorBoundary>
	)
}
