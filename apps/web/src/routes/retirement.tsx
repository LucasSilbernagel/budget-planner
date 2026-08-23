import { createFileRoute } from '@tanstack/react-router'
import { ErrorBoundary } from '../components/ErrorBoundary'
import RetirementAccumulationPlanner from '../components/RetirementAccumulationPlanner'
import { RetirementDisabledNotice } from '../components/retirement/RetirementDisabledNotice'
import { useShowRetirementPlanner } from '../stores/plannerVisibilityStore'

export const Route = createFileRoute('/retirement')({
  component: RetirementPage,
})

/**
 * Retirement Calculator Page
 *
 * Main page for retirement planning calculations.
 * Uses TanStack Start file-based routing (route: /retirement)
 *
 * Story 29.1 consolidated this page from three tools into one. It previously
 * mounted an accumulation planner, a standalone Safe-Withdrawal form and a
 * timeline chart side by side — each collecting its own copy of the same figures
 * and producing its own answer, with two paragraphs of copy explaining that the
 * numbers were "independent of" one another. There is now a single planner that
 * collects each detail once, plus the explanations that survived de-duplication.
 *
 * Story 29.2 then stopped asking for two of those details altogether: current
 * amount saved and monthly savings are derived from the user's own accounts and
 * budget, leaving four editable fields.
 */
function RetirementPage() {
  /**
   * Story 35.2 (FR55, AC-5): the route stays registered and reachable — the
   * preference gates the CONTENT, not the routing. Deliberately the same shape
   * as `routes/forecasting.tsx`'s premium gate, and deliberately NOT a
   * `beforeLoad`/`redirect()`: no route guard exists anywhere in this app, and
   * bouncing the user would explain nothing and break the in-app doc link.
   *
   * The Settings toggle and this gate read the same store independently, so
   * neither is the only thing standing between the user and the planner (the
   * dual-gate discipline `settings/report-section.tsx` documents).
   *
   * ⚠️ KNOWN AND ACCEPTED: unlike the nav entry, this branch has no pre-paint
   * equivalent. Every persisted store is `skipHydration: true`, so a direct
   * visit here with the planner hidden renders the planner on the first frame
   * and swaps to this notice after rehydration. Accepted on frequency: the nav
   * renders on EVERY page load for a hidden-planner user, whereas this route is
   * reached rarely and deliberately by someone who already knows they turned it
   * off. Covering it too would mean rendering both trees and swapping them in
   * CSS, which doubles the DOM and makes the planner do real work while hidden.
   */
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
      <div className="min-h-screen surface-sunken py-6 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <header className="mb-8 sm:mb-12">
            <div>
              <h1 className="text-2xl sm:text-4xl font-bold text-heading mb-3 sm:mb-4">
                Retirement Planner
              </h1>
              <p className="text-base sm:text-xl text-body">
                Your savings figures come from what you have already entered elsewhere. Add a few
                details about your plan to see when you can retire, how big your nest egg needs to
                be, and how your savings grow along the way.
              </p>
            </div>
          </header>

          {/* The planner: one shared input set driving the outlook, the required
              nest egg and the growth chart. */}
          <section className="mb-8 sm:mb-12 surface rounded-2xl shadow-lg p-4 sm:p-6 lg:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold text-subheading mb-2">
              When Can You Retire?
            </h2>
            <p className="text-body mb-8">
              Choose whether you want to draw your savings down to zero by your life expectancy or
              live off the returns forever — the target nest egg changes, your inputs don&rsquo;t.
            </p>

            <RetirementAccumulationPlanner />
          </section>

          {/* Supporting explanation — one copy of each, after the merge. */}
          <div className="surface rounded-2xl shadow-lg p-4 sm:p-6 lg:p-8">
            <h2 className="text-xl sm:text-2xl font-semibold text-subheading mb-6">
              Understanding Your Retirement Numbers
            </h2>

            <div className="p-4 surface-inset rounded-lg">
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
            </div>

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
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
