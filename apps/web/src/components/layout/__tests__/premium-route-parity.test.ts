import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// `HomePage` pulls in the premium gate, which reaches `usePremiumAccess`. This
// file only reads the exported benefit MAP — no rendering — but the import graph
// still has to resolve, so the hook is stubbed to something inert.
vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => ({
    status: {
      hasAccess: false,
      subscriptionStatus: null,
      isLoading: false,
      error: null,
      isAuthenticated: false,
    },
  }),
}))

import { PREMIUM_BENEFIT_IDS } from '../../../lib/premium/benefits'
import { OVERVIEW_BENEFITS } from '../../HomePage'
import { PREMIUM_NAV_ROUTES } from '../GlobalNav'

/**
 * The nav and the Overview name the same four premium routes (story 58.2, AC-1).
 *
 * ## Why this test is load-bearing rather than tidy
 *
 * FR88's sequencing rule says the Overview cards may only be trimmed once the
 * nav entries exist, "or a paid user is stranded with no route to these four
 * pages at all". Story 58.2 satisfied that ordering — and then went further than
 * FR88 anticipated:
 *
 *   - it removed the Overview cards for an entitled session (FR88), and
 *   - it removed the `/settings` tiles for `/report` and `/categories` (D2),
 *     which had been those two routes' only other entry point.
 *
 * **So the nav is now the ONLY route a paying user has to all four pages.** There
 * is no fallback surface left anywhere. The two lists of routes still live in two
 * files with nothing connecting them, and a rename on either side is a total
 * orphan: the nav entry disappears (or 404s) while the free tier keeps
 * advertising the page. No other test in this suite can see that — `GlobalNav`'s
 * own suite asserts the nav's hrefs against literals it also owns, and
 * `HomePage`'s asserts the Overview's against `OVERVIEW_BENEFITS`.
 *
 * ⚠️ A dev reading both files and agreeing they match is not evidence: it holds
 * at the moment of reading and never again. That is why AC-1 required this to be
 * executable.
 *
 * ## Why SETS, not sequences
 *
 * The two orders differ, both correctly. `PREMIUM_BENEFIT_IDS` is
 * `forecasting, report, profiles, categories` (story 5-20 put the
 * differentiating benefits first); the nav is
 * `Forecasting, Profiles, Report, Categories` and sits spliced before `Settings`
 * (story 58.1, decision D3). An order-sensitive assertion would fail on correct
 * code, and "fixing" either order to satisfy a test would undo a shipped
 * decision. Only the SET membership is a shared invariant.
 *
 * Labels are likewise excluded: the nav's short labels deliberately diverge from
 * `featureName` (58.1, decision D1).
 */
describe('58.2 AC-1: the nav and the Overview agree on the four premium routes', () => {
  /**
   * The Overview's link-rendering benefits, derived from the shipped map.
   *
   * ⚠️ Selected the way `HomePage` actually renders them — anything that is NOT
   * `'none'` or `'prompt'` falls through to the `<a href>` branch — rather than
   * by `activation === 'route'`. The two agree today, but a future activation
   * kind would render as a link while an `=== 'route'` filter silently excluded
   * it from this parity check, which is the one place that would notice.
   * (Code review, 2026-09-21.)
   */
  const overviewRoutes = PREMIUM_BENEFIT_IDS.flatMap((id) => {
    const benefit = OVERVIEW_BENEFITS[id]
    if (benefit.activation === 'none' || benefit.activation === 'prompt') return []
    return [benefit.href]
  })

  it('names the same four routes on both surfaces', () => {
    expect([...PREMIUM_NAV_ROUTES].sort()).toEqual([...overviewRoutes].sort())
  })

  it('carries exactly four, so neither list can quietly grow or shrink alone', () => {
    // A set-equality assertion alone would still pass if BOTH lists gained the
    // same wrong entry. Pinning the count makes an addition on either side a
    // deliberate act that has to update this expectation too.
    expect(PREMIUM_NAV_ROUTES).toHaveLength(4)
    expect(overviewRoutes).toHaveLength(4)
  })

  it('every premium route has a real route file behind it', () => {
    // ⚠️⚠️ THE HOLE THE SET-EQUALITY TEST ABOVE CANNOT SEE, and the one that
    // matters most now that the nav is a paid user's ONLY route to these pages.
    // Both lists are hand-written — `NavPath` is a literal union and
    // `OverviewBenefit.href` is a bare `string` — so renaming `/report` to
    // `/reports` on BOTH sides keeps them in perfect agreement, keeps the count
    // at four, and leaves the suite green while every paid user's only route to
    // the report 404s. Agreement between two wrong lists is not correctness.
    // (Code review, 2026-09-21.)
    //
    // File-based routing means `src/routes/<name>.tsx` IS the route, so the
    // filesystem is the authority to check against.
    const routesDir = resolve(__dirname, '../../../routes')
    for (const route of PREMIUM_NAV_ROUTES) {
      const file = resolve(routesDir, `${route.replace(/^\//, '')}.tsx`)
      expect(existsSync(file), `${route} has no route file at ${file}`).toBe(true)
    }
  })

  it('excludes Multi-device sync from the nav, which has no route to give it', () => {
    // `sync` is `activation: 'prompt'` — it opens the upgrade dialog and has no
    // page. It is the one benefit that CANNOT become a nav destination, which is
    // also why story 58.2's D1 left a paying user with no surface mentioning it
    // at all. Pinned here so a future addition of a `/sync` route has to come
    // through this test rather than silently unbalancing the two lists.
    expect(OVERVIEW_BENEFITS.sync.activation).toBe('prompt')
    expect(PREMIUM_NAV_ROUTES).not.toContain('/sync')
  })
})
