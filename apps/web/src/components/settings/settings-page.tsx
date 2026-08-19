import { AccountSection } from './account-section'
import { CategoriesSection } from './categories-section'
import { CurrencyToggle } from './currency-toggle'
import { LocalDataSection } from './local-data-section'
import { ReportSection } from './report-section'
import { RetirementVisibilityToggle } from './retirement-visibility-toggle'
import { ThemeToggle } from './theme-toggle'

/**
 * Consolidated settings surface, rendered by the `/settings` route
 * (story 11-6, Epic 11 UX review P2).
 *
 * Before this story the display preferences were scattered: the `CurrencyToggle`
 * was duplicated in every page header (implying page scope even though it changes
 * currency globally) and the `ThemeToggle` was buried in the global
 * footer. This surface gives them one predictable home reached from the
 * persistent `GlobalNav` (story 11-1) — Consistency & standards; Recognition
 * rather than recall.
 *
 * Both controls are the existing, unchanged `role="switch"` components, relocated
 * not rewritten. Exactly ONE `ThemeToggle` instance lives here (story 7-3
 * DECISION 2: a single gated instance avoids the `Modal` single-open assumption),
 * so this surface must never mount a second one.
 *
 * Design decision (UX, 2026-07-04): a dedicated route rather than a nav dropdown,
 * chosen for discoverability, clean mobile behaviour against the fixed bottom tab
 * bar, and as the extensible home for the account controls story 10-5 adds next
 * (sign-out + account deletion).
 *
 * Kept in `components/` (not inline in the route file) so the route stays
 * code-splittable — a route module must export only `Route` to be split.
 */
export function SettingsPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-400">
        These preferences apply across the whole app.
      </p>

      <section
        aria-labelledby="settings-display-heading"
        className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
      >
        <h2
          id="settings-display-heading"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          Display
        </h2>
        <div className="mt-4 space-y-6">
          <div>
            <CurrencyToggle />
            {/* Makes the global scope unambiguous (AC-2): the control no longer
                sits in a single page's header implying it is page-scoped. */}
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Applies everywhere amounts are shown.
            </p>
          </div>
          <div>
            <ThemeToggle />
          </div>
          {/* Retirement planner visibility — story 35.2, FR55. Placed in
              "Display" because it governs what the navigation shows, not what
              the app calculates: turning it off hides the entry and the page,
              and deletes nothing. */}
          <div>
            {/* ⚠️ The description is linked with `aria-describedby`, not merely
                placed nearby. It carries the data-safety reassurance, and this
                control sits in the same Settings surface as "Clear local data" —
                a screen-reader user who heard only "Show Retirement planner,
                switch, on" would get the switch without the reassurance. */}
            <RetirementVisibilityToggle describedBy="settings-retirement-visibility-description" />
            <p
              id="settings-retirement-visibility-description"
              className="mt-2 text-sm text-gray-500 dark:text-gray-400"
            >
              Turn this off to remove the Retirement planner from your navigation. Your income,
              expenses and balances are unaffected.
            </p>
          </div>
        </div>
      </section>

      {/* Clear local data — story 17-2. Available to EVERY user (rendered
          outside the auth-gated AccountSection below), distinct from the
          Premium "Delete account" control: this wipes only this device. */}
      <LocalDataSection />

      {/* Premium financial summary report — story 30-3. Surfaced-but-locked for
          free visitors (the /report route gates independently), and placed after
          Local data so the two data-facing controls sit together. */}
      <ReportSection />

      {/* Premium custom categories — story 30.4b. Surfaced-but-locked for free
          visitors (the /categories route gates independently). Placed after the
          report so the two gated entry points sit together. */}
      <CategoriesSection />

      {/* Account controls (sign-out + self-serve deletion) — story 10-5.
          Renders only for authenticated users; free/unauthenticated visitors
          see just the Display + Local data sections above. */}
      <AccountSection />
    </div>
  )
}
