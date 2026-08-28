/**
 * HomePage premium-discovery tests (story 7-2, FR24).
 *
 * FR24 requires premium features be discoverable-but-locked, not hidden. Before
 * this story `/forecasting` was linked from nowhere. These tests assert the
 * homepage now surfaces Advanced Forecasting:
 *   - free user → a locked control with a "Premium" badge (no working link).
 *   - paid user → a working link to /forecasting with no badge.
 *
 * `usePremiumAccess` is mocked to drive the tier. We assert the HYDRATED client
 * DOM (the resolved tier), not the SSR/loading skeleton — the unlock transition
 * is exactly what SSR-only smoke misses (project memory, 4-11).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderWithRouter } from '@/test/utils'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../hooks/usePremiumAccess'
import {
  useBalanceStore,
  useExpenseStore,
  useIncomeStore,
  useOverviewDurationStore,
  useSavingsStore,
} from '../../stores'

const usePremiumAccess = vi.fn()

vi.mock('../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../lib/premium/benefits'
import { HomePage, OVERVIEW_BENEFITS } from '../HomePage'

/**
 * How many benefit boxes are ROUTE-BACKED, i.e. carry an href and an "Open →"
 * once unlocked.
 *
 * ⚠️ Since story 41.1 this is NOT the number of gates. Every activatable benefit
 * renders a `PremiumFeatureGate` — sync included — so gate/skeleton counts are
 * {@link GATED_COUNT}, and only the "Open →" affordance tracks this number. The
 * two were the same figure until UX-DR45 split activatable from openable, which
 * is exactly the conflation that made a single boolean insufficient.
 *
 * Derived from the shipped map, never written as a literal. Story 33.2 had to hunt
 * down six separate hard-coded 3s and 2s across four files to expand the set from
 * three benefits to five; deriving means the next amendment cannot leave a stale
 * number behind in this file.
 */
const ROUTED_COUNT = PREMIUM_BENEFIT_IDS.filter(
  (id: PremiumBenefitId) => OVERVIEW_BENEFITS[id].activation === 'route'
).length

/** How many benefit boxes render as a `PremiumFeatureGate` in any tier state. */
const GATED_COUNT = PREMIUM_BENEFIT_IDS.filter(
  (id: PremiumBenefitId) => OVERVIEW_BENEFITS[id].activation !== 'none'
).length

/** Every routed benefit's accessible-name matcher paired with its route. */
const OPENABLE_ROUTES = PREMIUM_BENEFIT_IDS.flatMap((id) => {
  const benefit = OVERVIEW_BENEFITS[id]
  if (benefit.activation !== 'route') return []
  // Escaped: this helper's whole promise is that a new openable benefit needs no
  // edit here, and an unescaped `featureName` containing a regex metacharacter
  // ("Reports (beta)", "Sync + Backup") breaks on exactly the additions it claims
  // to absorb — silently matching the wrong element or none.
  const name = new RegExp(benefit.featureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  return [[name, benefit.href] as const]
})

/**
 * The `PREMIUM_BOX_BASE` token list every benefit box must carry (story 30-1, FR51).
 *
 * ⚠️ Module-scoped so the LOCKED and ENTITLED tiers assert the SAME list. It used
 * to live inside the locked-tier chassis test, which iterated `[sync, ...tiles]`.
 * When story 41.1 made sync a gate, sync dropped out of that free-tier query and
 * only the background-token half of its coverage was re-homed — leaving the
 * entitled box's chassis asserted nowhere. Mutation that survived until this was
 * lifted: strip `PREMIUM_BOX_BASE` from the entitled branch and a paying user's
 * sync box loses its border, radius and padding with the whole suite green.
 */
const CHASSIS = [
  'flex',
  'w-full',
  'items-center',
  'justify-between',
  'gap-3',
  'rounded-md',
  'border',
  'border-default',
  'px-4',
  'py-3',
] as const

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
  const status: PremiumAccessStatus = {
    hasAccess: false,
    subscriptionStatus: null,
    isLoading: false,
    error: null,
    isAuthenticated: false,
    ...overrides,
  }
  usePremiumAccess.mockReturnValue({ status })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HomePage premium discovery', () => {
  it('AC-1: shows Advanced Forecasting locked with a Premium badge for a free user', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    // Scope the badge to the forecasting control: the Premium Features section
    // now also carries a locked Custom Profiles entry (story 13-3), so there is
    // more than one "Premium" badge on the page for a free user.
    const forecasting = screen.getByRole('button', {
      name: /advanced forecasting — premium, locked/i,
    })
    expect(within(forecasting).getByText('Premium')).toBeInTheDocument()
    // Not a usable link for free users.
    expect(screen.queryByRole('link', { name: /advanced forecasting/i })).not.toBeInTheDocument()
  })

  it('AC-3: shows a working /forecasting link with no badge for a paid user', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const link = screen.getByRole('link', { name: /advanced forecasting/i })
    expect(link).toHaveAttribute('href', '/forecasting')
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /premium, locked/i })).not.toBeInTheDocument()
  })

  it('30-2: pins the Advanced Forecasting subtitle to the honest capability copy', () => {
    // The tile subtitle (shared by locked + unlocked states) must describe only
    // what ships. Story 20-1 wrote this pin when saved forecasts could NOT be
    // reloaded and the Projections chart showed canned sample data, so it
    // deliberately withheld the reload claim. Story bug-3 shipped both — reload
    // is wired end-to-end (`routes/forecasting.tsx:381,395`) and the chart takes
    // the user's own result (`:387`) — so story 30-2 adds "reloadable", which the
    // in-app copy at `routes/forecasting.tsx:5,:351` had already been stating.
    // Pin the exact string so future overpromising drift breaks this test.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    expect(
      screen.getByText('What-if scenario modeling with saved, searchable, reloadable forecasts')
    ).toBeInTheDocument()
  })

  it('AC-1: shows Custom Profiles locked with a Premium badge for a free user (13-3)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    const profiles = screen.getByRole('button', { name: /custom profiles — premium, locked/i })
    expect(within(profiles).getByText('Premium')).toBeInTheDocument()
    // Not a usable link for free users.
    expect(screen.queryByRole('link', { name: /custom profiles/i })).not.toBeInTheDocument()
  })

  it('AC-3: shows a working /profiles link with no badge for a paid user (13-3)', () => {
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const link = screen.getByRole('link', { name: /custom profiles/i })
    expect(link).toHaveAttribute('href', '/profiles')
    expect(
      screen.queryByRole('button', { name: /custom profiles — premium, locked/i })
    ).not.toBeInTheDocument()
  })

  it('41.1: badges AND gates every benefit including sync, with no page affordance (UX-DR45)', () => {
    // ⚠️ THIS ASSERTION HAS NOW BEEN REVERSED TWICE, and the history is the point.
    // Story 20-2 withheld the lock badge from Multi-device sync on the grounds
    // that a lock affordance implies an openable page, pinned here as
    // `toHaveLength(2)`. UX-DR39 (33.1) amended that: sync IS premium, so it took
    // the badge — but stayed a static <div>, and THIS TEST asserted it had no
    // button, no gate and no dialog. UX-DR45 (41.1) reverses that half too: the
    // box is activatable and opens the shared upgrade dialog.
    //
    // What has survived all three: there is still no /sync route, so sync gains no
    // href, no <a> and no "Open →". That is the ONE claim below that has never
    // moved, and the reason the others are rewritten rather than deleted — the
    // behaviours stay pinned, in their new form.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    const sync = screen.getByTestId('premium-benefit-sync')
    // The benefit is surfaced as text…
    expect(within(sync).getByText('Multi-device sync')).toBeInTheDocument()
    // …carries the lock badge (the half of 20-2 that UX-DR39 retired)…
    expect(within(sync).getByText('Premium')).toBeInTheDocument()
    // …and is now an activatable control with the gate's accessible name (the
    // half of 33.1 that UX-DR45 retires — this exact query asserted `not` before).
    const syncButton = screen.getByRole('button', {
      name: /multi-device sync — premium, locked/i,
    })
    expect(sync).toContainElement(syncButton)
    expect(within(sync).getByTestId('premium-gate-locked')).toBe(syncButton)

    // …but STILL never a page: no link, no href, no "Open →", in this or any state.
    expect(screen.queryByRole('link', { name: /multi-device sync/i })).not.toBeInTheDocument()
    expect(within(sync).queryByRole('link')).toBeNull()
    expect(within(sync).queryByText('Open →')).toBeNull()
    expect(syncButton).not.toHaveAttribute('href')

    // EVERY box carries a badge — 2 before UX-DR39, 3 before story 33.2 expanded
    // the canonical set to five (FR56) — and since UX-DR45 every box is a gate.
    expect(screen.getAllByText('Premium')).toHaveLength(PREMIUM_BENEFIT_IDS.length)
    expect(screen.getAllByTestId('premium-gate-locked')).toHaveLength(GATED_COUNT)
    expect(GATED_COUNT).toBe(PREMIUM_BENEFIT_IDS.length)
  })

  it('41.1: shows no badge on sync while the tier is unresolved, and no lock button', () => {
    // AC-5 of story 33.1, re-homed. An errored SSR seed resolver yields
    // `isLoading: true` (NOT signed out — `server/api/auth/session-seed.ts:44-50`
    // returns null on error), so the loading branch is a real, reachable
    // production state, not just first paint. Sync must not be the one box showing
    // a lock while the tier is unknown.
    //
    // ⚠️ REWRITTEN, NOT DELETED. Until story 41.1 sync owned a bespoke pending
    // placeholder (`premium-benefit-sync-badge-pending`) because it was not a gate.
    // It is a gate now, so the guarantee is the SAME but it is `SkeletonBlock` that
    // provides it: aria-hidden, no lock badge announced, no activatable control
    // while the tier is unknown. What this test still owns is that the guarantee
    // holds FOR SYNC specifically, which a gate-count assertion alone would not say.
    mockStatus({ hasAccess: false, isLoading: true, subscriptionStatus: null })
    render(<HomePage />)

    expect(screen.getAllByTestId('premium-gate-skeleton')).toHaveLength(GATED_COUNT)
    expect(screen.queryAllByTestId('premium-gate-locked')).toHaveLength(0)

    const sync = screen.getByTestId('premium-benefit-sync')
    const pending = within(sync).getByTestId('premium-gate-skeleton')
    expect(pending).toHaveAttribute('aria-hidden', 'true')

    // Fail-closed while unknown: nothing to activate, and no badge claiming a tier
    // the app has not resolved. The skeleton renders the tier-agnostic label only.
    expect(within(sync).queryByRole('button')).toBeNull()
    expect(within(sync).queryByText('Premium')).toBeNull()
    expect(within(sync).getByText('Multi-device sync')).toBeInTheDocument()
  })

  it('33.1: badges sync when the tier check errors — fail-closed (AC-5)', () => {
    // No gate in this repo reads `status.error`; fail-closed works because an
    // errored check resolves to `hasAccess: false` and falls through to the locked
    // branch. Sync must inherit that contract rather than inventing an error path.
    mockStatus({
      hasAccess: false,
      isLoading: false,
      error: 'network',
      subscriptionStatus: 'free',
      isAuthenticated: false,
    })
    render(<HomePage />)

    const sync = screen.getByTestId('premium-benefit-sync')
    expect(within(sync).getByText('Premium')).toBeInTheDocument()
    expect(within(sync).queryByTestId('premium-gate-skeleton')).toBeNull()
    // An errored check must present as LOCKED — and since story 41.1 that means
    // activatable, so the user is told how to unlock rather than left at a
    // dead end by a failure they cannot see.
    expect(within(sync).getByTestId('premium-gate-locked')).toBeInTheDocument()
  })

  it('41.1: an entitled user gets the sync box exactly as before — inert, unbadged (AC-5)', () => {
    // The page-wide `queryByText('Premium')` assertion in the paid-tier test at
    // the top of this describe block (`AC-3: … no badge for a paid user`) also
    // fails if the sync badge is unconditional. This one names the box, so the
    // failure message points at sync rather than at "somewhere on the page".
    //
    // ⚠️ THE ENTITLED STATE IS THE HALF STORY 41.1 DOES NOT CHANGE. Sync has no
    // page, so an entitled user gains nothing to activate: no gate button, no
    // dialog, no badge, no link — the same inert `surface-inset` box it has always
    // been. Everything UX-DR45 adds lives in the locked and loading branches.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const sync = screen.getByTestId('premium-benefit-sync')
    expect(within(sync).getByText('Multi-device sync')).toBeInTheDocument()
    expect(within(sync).queryByText('Premium')).toBeNull()
    expect(within(sync).queryByTestId('premium-gate-skeleton')).toBeNull()
    expect(within(sync).queryByTestId('premium-gate-locked')).toBeNull()
    expect(within(sync).queryByRole('button')).toBeNull()
    expect(within(sync).queryByRole('link')).toBeNull()
    expect(within(sync).queryByText('Open →')).toBeNull()

    // The chassis an entitled user sees is the inert one, NOT the interactive one
    // the locked state uses. Both tokens set `background-color` in @layer
    // components, so exactly one may be present (see PREMIUM_BOX_BASE's docblock).
    //
    // ⚠️ Anchored STRUCTURALLY — the wrapper's only child — never by
    // `closest('div.surface-inset')`. Selecting the element by the class you then
    // assert cannot fail: `toContain('surface-inset')` is guaranteed by the
    // selector. Worse, `closest()` walks to the document root rather than stopping
    // at the wrapper, so giving the real box `PREMIUM_BOX_INTERACTIVE` while any
    // ANCESTOR carried `surface-inset` would pass all three assertions on the
    // wrong element. The gate returns bare `{children}` when entitled, so the
    // wrapper's first child IS the box.
    const syncBox = sync.firstElementChild
    expect(syncBox, "the entitled sync box must be the wrapper's only child").not.toBeNull()
    expect(sync.children).toHaveLength(1)
    const syncBoxTokens = (syncBox?.className ?? '').split(/\s+/)
    expect(syncBoxTokens).toContain('surface-inset')
    expect(syncBoxTokens).not.toContain('surface-interactive')
    expect(syncBoxTokens).not.toContain('transition-colors')

    // P1: the full chassis, not just the background token. The entitled box has to
    // read as one set with the four routed boxes exactly as the locked one does.
    for (const token of CHASSIS) {
      expect(syncBoxTokens, `the entitled sync box is missing "${token}"`).toContain(token)
    }
    expect(syncBoxTokens.filter((t) => t.startsWith('dark:'))).toEqual([])

    // AC-4's other half, asserted here rather than assumed: the routed boxes
    // still link through and still carry their "Open →" for an entitled user.
    // Iterates the shipped map, so a new routed benefit is covered the moment it
    // is added rather than needing this list edited too.
    expect(OPENABLE_ROUTES).toHaveLength(ROUTED_COUNT)
    for (const [name, href] of OPENABLE_ROUTES) {
      const link = screen.getByRole('link', { name })
      expect(link).toHaveAttribute('href', href)
      expect(within(link).getByText('Open →')).toBeInTheDocument()
    }
  })

  it('33.2: pins the two new benefit sub-texts verbatim (FR56)', () => {
    // The forecasting and profiles sub-texts have had verbatim pins since 20-2/30-2;
    // the two added by 33.2 had none, and the parity test's honesty checks turned out
    // to be satisfiable by the other surfaces — a mutation deleting ", and see what
    // each category totals" from the Overview passed 79/79. Vague drift in either
    // string now breaks here, on the surface that owns it.
    //
    // Both strings are bounded by what ships: the report is print-in-browser over
    // budget/net worth/savings (no retirement, no charts, no app-generated PDF), and
    // categories cover income and expenses only and never sync.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    expect(
      screen.getByText(
        'A print-ready summary of your budget, net worth and savings, built in your browser'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('Group your income and expenses your way, and see what each category totals')
    ).toBeInTheDocument()
  })

  it('30-1: every premium benefit box shares one chassis (AC-1/AC-3)', () => {
    // FR51: the section must read as ONE set. Every benefit box carries an
    // identical base class string. Asserted by class-TOKEN membership (never
    // substring), so `sm:p-6` can never be mistaken for `p-6` (batch-4 lesson,
    // mirrored from the 19-4 test below).
    //
    // ⚠️ Since story 41.1 every box in the LOCKED state is a gate, sync included,
    // so `premium-gate-locked` is the whole set here — there is no separate static
    // box to add. The inert-chassis half of this assertion moved to the entitled
    // test above, which is the only tier where sync still renders one.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    // Several locked tiles render for a free user, so getBy* would throw here.
    const tiles = screen.getAllByTestId('premium-gate-locked')
    expect(tiles).toHaveLength(GATED_COUNT)

    for (const box of tiles) {
      const tokens = box.className.split(/\s+/)
      for (const token of CHASSIS) {
        expect(tokens, `${box.dataset.testid ?? 'tile'} is missing "${token}"`).toContain(token)
      }
      // AC-3: no hand-rolled colour + dark: pair survives on any box. Compared
      // as EXACT tokens — `t.includes('blue-50')` would also match the legitimate
      // `focus-visible:ring-blue-500`, which is the very substring trap this
      // file's other class assertions exist to avoid.
      expect(tokens.filter((t) => t.startsWith('dark:'))).toEqual([])
      const RETIRED = ['bg-blue-50', 'border-blue-200', 'hover:bg-blue-100']
      expect(tokens.filter((t) => RETIRED.includes(t))).toEqual([])
    }

    // AC-4 as amended by UX-DR45: every ACTIVATABLE box carries the interactive
    // extras, which for a non-entitled user is all of them.
    for (const tile of tiles) {
      const tokens = tile.className.split(/\s+/)
      expect(tokens).toContain('surface-interactive')
      expect(tokens).toContain('focus-visible:ring-2')
      expect(tokens).toContain('focus-visible:ring-blue-500')
      // Never both background tokens on one element — they collide by source
      // order. Asserting only one side leaves the likelier mistake — editing
      // PREMIUM_BOX_INTERACTIVE — green.
      expect(tokens).not.toContain('surface-inset')
    }

    // …and sync is genuinely one of them, named rather than counted: a count of
    // GATED_COUNT would also be satisfied by five gates none of which is sync.
    expect(screen.getByTestId('premium-benefit-sync')).toContainElement(
      screen.getByRole('button', { name: /multi-device sync — premium, locked/i })
    )
  })

  it('30-1: the unlocked (paid) tiles carry the chassis and the accent (AC-1/AC-4)', () => {
    // The paid path renders a different element (`<a>`, not the gate's button),
    // so nothing in the free-tier test above touches it. Without this, dropping
    // PREMIUM_BOX_INTERACTIVE or `text-accent` from both links leaves the whole
    // suite green — verified by mutation during review.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const links = OPENABLE_ROUTES.map(([name]) => screen.getByRole('link', { name }))
    expect(links).toHaveLength(ROUTED_COUNT)

    for (const link of links) {
      const tokens = link.className.split(/\s+/)
      for (const token of ['flex', 'w-full', 'rounded-md', 'border', 'border-default', 'px-4']) {
        expect(tokens).toContain(token)
      }
      expect(tokens).toContain('surface-interactive')
      expect(tokens).toContain('focus-visible:ring-blue-500')
      expect(tokens.filter((t) => t.startsWith('dark:'))).toEqual([])

      // "Open →" is the paid tier's clickability signal — it must stay accented.
      const open = within(link).getByText('Open →')
      expect(open.className.split(/\s+/)).toContain('text-accent')
    }
  })

  it('41.1: every locked box carries a persistent chevron, sync included (AC-2)', () => {
    // Hover does not exist on touch and the locked state has no "Open →", so
    // the chevron is the only cue a free visitor on a phone gets that a box does
    // something at all.
    //
    // ⚠️ REVERSED BY UX-DR45, and this is the assertion that carries the reversal.
    // Story 33.1 pinned sync's chevron as `invisible` because sync did nothing;
    // 41.1 makes it activatable, so hiding the one affordance a touch user has
    // would ship the exact defect UX-DR45 was raised to fix. Decision ratified by
    // Lucas, 2026-08-27. The ENTITLED state keeps the invisible chevron — asserted
    // separately below, because that is the tier where sync still opens nothing.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    render(<HomePage />)

    const tiles = screen.getAllByTestId('premium-gate-locked')
    expect(tiles).toHaveLength(GATED_COUNT)
    for (const tile of tiles) {
      const chevron = within(tile).getByText('›')
      expect(chevron.className.split(/\s+/)).toContain('text-accent')
      // Decorative: the button already announces "<feature> — premium, locked".
      expect(chevron).toHaveAttribute('aria-hidden', 'true')
    }

    // Named, not just counted: sync's own chevron must be a painted one.
    const syncChevron = within(screen.getByTestId('premium-benefit-sync')).getByText('›')
    expect(syncChevron.className.split(/\s+/)).not.toContain('invisible')
    expect(syncChevron).toHaveAttribute('aria-hidden', 'true')
    for (const tile of tiles) {
      expect(within(tile).getByText('›').className.split(/\s+/)).not.toContain('invisible')
    }
  })

  it('41.1: activating the sync box opens the SHARED upgrade dialog (AC-1/AC-7)', async () => {
    // ⚠️ THE WHOLE POINT OF UX-DR45, and it is asserted FROM THE SYNC BOX
    // specifically rather than from any gate. A test that clicked
    // `getAllByTestId('premium-gate-locked')[0]` would have passed before this
    // story — the first gate was already Advanced Forecasting and already opened
    // this dialog. Naming the box is what makes this test about sync.
    //
    // The REAL `PremiumPrompt` renders here, not a stub, so this proves the
    // shared dialog opens rather than that the right props were passed to
    // something. `renderWithRouter` is required because the dialog's CTA is a
    // TanStack <Link>.
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })
    renderWithRouter(<HomePage />)

    // `renderWithRouter` mounts a RouterProvider, which resolves its route
    // asynchronously — the first synchronous frame is empty, so the box has to be
    // awaited rather than queried. (`render` elsewhere in this file is synchronous
    // because it mounts HomePage directly.)
    const sync = await screen.findByTestId('premium-benefit-sync')
    expect(screen.queryByRole('dialog', { name: /go premium/i })).not.toBeInTheDocument()

    fireEvent.click(
      within(sync).getByRole('button', { name: /multi-device sync — premium, locked/i })
    )

    const dialog = await screen.findByRole('dialog', { name: /go premium/i })
    // Same component the other gates open: same accessible name, same benefit
    // list, same /pricing CTA. `PremiumFeatureGate` overrides PremiumPrompt's own
    // `/login` default with `/pricing` (story 7-2, DECISION 2) — asserting the
    // href is what distinguishes "the shared dialog" from "a dialog".
    expect(within(dialog).getByRole('link', { name: /upgrade to premium/i })).toHaveAttribute(
      'href',
      '/pricing'
    )
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(PREMIUM_BENEFIT_IDS.length)

    // …and the dialog is a SIBLING of the button inside sync's wrapper, which is
    // what keeps the non-portalled overlay out of the space-y-3 stack's margin.
    // The overlay's actual position is an e2e claim — jsdom computes no layout —
    // so this asserts the STRUCTURE the e2e measurement depends on.
    expect(sync).toContainElement(dialog)
  })

  it("41.1: an ENTITLED user still gets sync's reserved, unpainted chevron (AC-2/AC-5)", () => {
    // The half of story 33.1's chevron rule that survives. An entitled user's sync
    // box opens nothing, so it must not advertise that it does — but it still has
    // to RESERVE the glyph's box, or its row sits ~26px out of line with the
    // "Open →" rows beside it. `invisible` (visibility:hidden) keeps the layout
    // box; `hidden`/`display:none` would collapse it. The reserve mirrors the REAL
    // glyph rather than a px literal because `›` is text and its width varies
    // 5.06–7.20px by font.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    const syncChevron = within(screen.getByTestId('premium-benefit-sync')).getByText('›')
    expect(syncChevron.className.split(/\s+/)).toContain('invisible')
    expect(syncChevron).toHaveAttribute('aria-hidden', 'true')
  })

  it('20-2: explains Custom Profiles with a concrete example (CONTENT-H)', () => {
    // The Custom Profiles subtitle (shared by locked + unlocked states) must name
    // a concrete use case so a user grasps what a profile is for, kept consistent
    // with the Features/Pricing wording ("personal vs. household"). Pin the exact
    // string so vague drift breaks this test.
    mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })
    render(<HomePage />)

    expect(
      screen.getByText(
        'Keep separate finances — e.g. personal vs. household — and switch without mixing the numbers'
      )
    ).toBeInTheDocument()
  })
})

/**
 * Subtitle parity across the two first-contact surfaces (story 36-1).
 *
 * `HomePage.tsx` and `routes/login.tsx` both render the wordmark plus this
 * subtitle, and the decision to ship it WITHOUT a trailing period exists only
 * so the two read identically. Until this test, that invariant was asserted in
 * two shipped comments and pinned by nothing: editing `login.tsx` would have
 * left every suite green while silently falsifying both comments.
 *
 * Asserted by reading source rather than rendering, because `login.tsx` is a
 * `Route.useSearch()` component that cannot be rendered via `renderWithRouter`
 * (project memory, epic 21). Reading the file is what makes the invariant
 * testable at all — and it is the string, not the render, that must match.
 */
describe('subtitle parity: HomePage and login (story 36-1)', () => {
  const SUBTITLE = 'Track your finances with privacy and control'
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8')

  it('both first-contact surfaces render the identical subtitle string', () => {
    expect(read('../HomePage.tsx')).toContain(`>${SUBTITLE}</p>`)
    expect(read('../../routes/login.tsx')).toContain(`>${SUBTITLE}</p>`)
  })

  it('neither surface has re-grown a trailing period', () => {
    // The whole point of the no-period decision. A period on either side makes
    // the two surfaces differ, which is what this pair exists to prevent.
    expect(read('../HomePage.tsx')).not.toContain(`>${SUBTITLE}.</p>`)
    expect(read('../../routes/login.tsx')).not.toContain(`>${SUBTITLE}.</p>`)
  })
})

/**
 * Homepage subtitle (story 36-1, CONTENT-N — supersedes story 27-4 / FR44).
 *
 * The overview header leads with "Track your finances with privacy and control"
 * as the single subtitle beneath the app-name heading. This retires the 27-4
 * privacy-stance tagline, which in turn had superseded the 25-4 "never sees your
 * money" line and the 19-4 "bird's-eye" secondary subtitle. Tier-independent, so
 * a single free-user render is sufficient.
 *
 * The expected string carries NO trailing period. That is deliberate: it is
 * byte-identical to the line already shipped at `routes/login.tsx`, and
 * `getByText` with a plain string is an exact whole-text match, so a stray
 * period fails here rather than drifting the two surfaces apart silently.
 */
describe('HomePage subtitle (story 36-1)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it('surfaces the new subtitle while keeping the app name', () => {
    render(<HomePage />)
    expect(screen.getByText('Track your finances with privacy and control')).toBeInTheDocument()
    // The app name still appears as the header heading.
    expect(screen.getByRole('heading', { name: 'Longhand Budget', level: 1 })).toBeInTheDocument()
    // Guard: the retired SoluBudget wordmark must not return (story brand-1).
    expect(screen.queryByText(/solubudget/i)).toBeNull()
    // Guards: BOTH superseded taglines must stay gone (batch-5 regression
    // lesson). The 27-4 line is the one this story retires; the 25-4 line was
    // retired before it, and dropping its guard would quietly widen the gap.
    expect(screen.queryByText(/minds its own business/i)).toBeNull()
    expect(screen.queryByText('The budget planner that never sees your money')).toBeNull()
  })
})

/**
 * Overview subtitle + mobile section padding (story 19-4, CONTENT-F / UX-DR32).
 *
 * Story 27-4 superseded the two-line header: the "bird's-eye" secondary subtitle
 * that 19-4 added is REMOVED, leaving a single line as the only subtitle — since
 * story 36-1 that line is "Track your finances with privacy and control". The
 * mobile-padding coverage from 19-4 is independent of the header copy and
 * remains in force — the empty-state onboarding and Premium Features
 * sections stay tightened with responsive utilities (p-4 sm:p-6 / p-6 sm:p-8) so
 * the ≥640px desktop spacing is unchanged.
 *
 * Padding is asserted by class-token membership (not substring regex) so a
 * Tailwind class like `sm:p-6` cannot be mistaken for `p-6` (project memory,
 * batch-4 lesson).
 */
describe('HomePage overview subtitle + mobile padding (story 19-4)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it("no longer renders the bird's-eye secondary subtitle (removed by story 27-4)", () => {
    render(<HomePage />)
    // The 36-1 subtitle is the single subtitle; the 19-4 supporting line is gone.
    expect(screen.getByText('Track your finances with privacy and control')).toBeInTheDocument()
    expect(
      screen.queryByText("Get a bird's-eye view of your income, expenses, savings, and more!")
    ).toBeNull()
  })

  it('AC-2: Premium Features section is mobile-tight (p-4) and restores padding at sm (sm:p-6)', () => {
    render(<HomePage />)
    const section = screen
      .getByRole('heading', { name: 'Premium Features', level: 2 })
      .closest('section')
    expect(section).not.toBeNull()
    const tokens = (section as HTMLElement).className.split(/\s+/)
    expect(tokens).toContain('p-4')
    expect(tokens).toContain('sm:p-6')
  })

  it('AC-2: empty-state onboarding section is mobile-tight (p-4) and restores padding at sm (sm:p-6)', () => {
    // The onboarding section renders only when there is NO financial data at all —
    // since the ux-2 review fix, `hasData` counts savings/balances too, so all
    // four stores must be empty for this state.
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })
    render(<HomePage />)
    const section = screen.getByText("Let's set up your budget").closest('section')
    expect(section).not.toBeNull()
    const tokens = (section as HTMLElement).className.split(/\s+/)
    expect(tokens).toContain('p-4')
    expect(tokens).toContain('sm:p-6')
  })
})

/**
 * Privacy positioning strip (story 27-5, FR45).
 *
 * Beneath the 27-4 tagline the header carries a compact strip that states the
 * three privacy pillars — usable with no account, an optional EU-hosted sync,
 * and no bank connection — under the "intentional budgeting without the bank
 * sync" framing. Every claim is true: the Free tier is client-only (no account,
 * data stays in the browser), EU-hosting is scoped to the OPTIONAL Premium sync
 * (so the copy never implies free-tier data touches a server), and there is no
 * bank/transaction-import integration. Tier-independent, so a single free-user
 * render suffices.
 *
 * The load-bearing assertion anchors on the distinguishing framing sentence:
 * generic words like "account"/"bank"/"EU" appear elsewhere on the page and in
 * the docs, so asserting them alone would pass by construction (batch-5/23
 * lesson). This strip is ADDITIVE — it must not disturb the 27-4 tagline or the
 * 19-4 mobile-padding coverage above.
 */
describe('HomePage privacy positioning (story 27-5)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
  })

  it('surfaces the "without bank sync or AI integrations" framing (FR45 as amended by brand-1)', () => {
    render(<HomePage />)
    expect(
      screen.getByText('Intentional budgeting without bank sync or AI integrations.')
    ).toBeInTheDocument()
    // Guard: the pre-amendment wording must not return. Note it is NOT a prefix
    // of the new copy ("the bank sync" vs "bank sync"), so this genuinely bites.
    expect(screen.queryByText('Intentional budgeting without the bank sync.')).toBeNull()
  })

  /**
   * brand-1 AC-6: the no-AI claim lands on the FRAMING line only.
   *
   * The positioning block holds two lines; stating "no AI" on both would repeat
   * the claim inside a two-line block. This pins the split so a later edit
   * cannot quietly duplicate it onto the three-pillar line.
   */
  it('states the no-AI claim once, on the framing line and not the pillars line', () => {
    render(<HomePage />)
    const pillars = screen.getByText(
      /No account needed · Optional sync is EU-hosted · No bank connection\./
    )
    expect(pillars).toBeInTheDocument()

    // Scoped to the two lines directly, not a whole-page count (code review): a
    // page-wide `queryAllByText(/\bAI\b/)` length of 1 would STILL read as 1 if
    // the claim were MOVED onto the pillars line, so it never pinned the split
    // its name promises. `artificial intelligence` is included because that is
    // the phrasing a copy edit would most plausibly introduce, and `\bAI\b`
    // alone is blind to it.
    const framing = screen.getByText('Intentional budgeting without bank sync or AI integrations.')
    expect(framing).toHaveTextContent(/\bAI\b/)
    expect(pillars).not.toHaveTextContent(/\bAI\b|artificial intelligence/i)
  })

  it('states the three privacy pillars with EU-hosting scoped to the optional sync (no over-claiming)', () => {
    render(<HomePage />)
    // One line covering all three pillars; "Optional sync is EU-hosted" keeps the
    // EU claim on the paid sync so free-tier (client-only) data is never implied
    // to reach a server.
    expect(
      screen.getByText('No account needed · Optional sync is EU-hosted · No bank connection.')
    ).toBeInTheDocument()
  })
})

/**
 * Overview "Manage Your Finances" tiles removed on desktop (story 19-1, UX-DR26).
 *
 * The tile grid linked Income/Expenses/Savings/Balance/Projections — the exact
 * five destinations the desktop top-bar GlobalNav already links at ≥640px, so on
 * the overview it was a second copy of the primary menu. Story 18-3 had already
 * hidden the section below 640px (the fixed bottom nav covers those links there);
 * story 19-1 removes it on desktop too, so the section is gone at every width.
 * Nothing is orphaned — every destination stays reachable via the top bar
 * (≥640px) and the fixed bottom bar (<640px), both owned by GlobalNav (which is
 * not rendered in this component-level harness).
 *
 * These assertions replace the former story-11-3 (color-as-meaning), 18-1
 * (label-overflow) and 18-3 (hidden-below-640px) tile blocks, all of which
 * asserted the now-removed tiles' presence/styling and would be vacuous.
 */
describe('HomePage "Manage Your Finances" tiles removed (story 19-1)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    // Force the empty-state branch so the assertions are independent of any
    // persisted store data — the removed section rendered regardless of data.
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
  })

  it('AC-2: the "Manage Your Finances" section is not rendered', () => {
    render(<HomePage />)
    // A DOM-presence check: the section was fully removed (not CSS-hidden), so
    // its heading is absent from the render tree. jsdom has no layout engine, so
    // this asserts non-rendering rather than any width-specific behavior — the
    // "gone at every width" guarantee comes from the removal itself, since there
    // is no longer a `hidden sm:block` branch that could reintroduce it.
    expect(screen.queryByRole('heading', { name: 'Manage Your Finances' })).toBeNull()
  })

  it('AC-2/AC-3: the tile-only "Projections" destination link is no longer on the overview', () => {
    render(<HomePage />)
    // "Projections" was unique to the removed tile grid; the surviving overview
    // surfaces (stat cards, empty-state CTAs, Premium section) never use that
    // label. Its absence proves the tile grid is gone without coupling to the
    // persistent nav (owned by GlobalNav, not rendered in this harness).
    expect(screen.queryByRole('link', { name: 'Projections' })).toBeNull()
  })
})

/**
 * Financial Overview copy (story 11-4, "Match between the system and the real
 * world"). The stat cards used to surface internal normalization vocabulary
 * ("(Monthly Normalized)", a bare "Raw: …" sub-line). These tests assert the
 * plain-language labels and that the monthly-conversion explanation is available
 * progressively via an info affordance rather than a jargon-y sub-line.
 */
describe('HomePage financial overview copy (story 11-4)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  it('AC-1: stat cards read in plain language with no "Normalized"/"Raw" jargon', () => {
    render(<HomePage />)
    // The duration suffix ("(per week/month/year)") is chosen by the story 12-2
    // selector; the plain-language intent is duration-agnostic.
    expect(screen.getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)).toBeInTheDocument()
    expect(
      screen.getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Normalized/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Raw:/)).not.toBeInTheDocument()
  })

  it('AC-2: a normalized non-monthly amount drops the "Raw:" line and reveals the conversion (with the raw total) progressively on focus', async () => {
    // A weekly amount normalizes to ~4.33× its entry, so the monthly figure
    // differs from what was entered and the info affordance renders.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'test-weekly',
          userId: 0,
          name: 'Weekly gig',
          amount: 10000,
          frequency: 'weekly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    render(<HomePage />)

    // No bare engineering sub-line.
    expect(screen.queryByText(/^Raw:/)).not.toBeInTheDocument()

    // Progressive disclosure: the explanation is not present until the trigger is
    // focused/hovered — no tooltip and no association at rest.
    const trigger = screen.getByRole('button', {
      name: /more information about the income figure/i,
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(trigger).not.toHaveAttribute('aria-describedby')

    // On focus, the tooltip appears, is associated for assistive tech, explains the
    // conversion, and surfaces the raw entered total.
    fireEvent.focus(trigger)
    const tooltip = await screen.findByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-describedby')
    expect(tooltip).toHaveTextContent(
      /convert weekly, biweekly, monthly, and annual amounts to a common monthly basis so your totals are comparable/i
    )
    // Story 23-1: the tooltip must disclose the averaging (~4.33 weeks/month) that
    // makes the totals estimates, consistent with the FAQ + features copy. The
    // wording is duration-neutral ("these totals are estimates"), not "the monthly
    // figure", because the card can display per-week/per-year via the duration selector.
    expect(tooltip).toHaveTextContent(/about 4\.33 weeks a month/i)
    expect(tooltip).toHaveTextContent(/these totals are estimates/i)
    expect(tooltip).toHaveTextContent(/entered total before conversion/i)
  })
})

/**
 * Financial Overview no longer surfaces the opaque "Financial Health" score
 * (story 11-5, "Aesthetic-and-minimalist design" + Trust). The score was a
 * single uninterpretable percentage derived from arbitrary constants; it was
 * removed rather than explained. These tests assert the card is gone and the
 * overview grid reflows to the four remaining cards with no empty column.
 */
describe('HomePage financial overview — no Financial Health score (story 11-5)', () => {
  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
  })

  it('AC-1/AC-2: the "Financial Health" card and its percentage are gone', () => {
    render(<HomePage />)
    expect(screen.queryByText('Financial Health')).not.toBeInTheDocument()
    // No stray "NN%" score value remains in the overview.
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument()
  })

  it('AC-1: the three remaining overview cards still render', () => {
    render(<HomePage />)
    expect(screen.getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)).toBeInTheDocument()
    expect(
      screen.getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
    ).toBeInTheDocument()
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
  })

  it('AC-1: the "Net Period Income" card and its figure are gone', () => {
    render(<HomePage />)
    expect(screen.queryByText('Net Period Income')).not.toBeInTheDocument()
  })

  it('AC-2: the overview grid reflows to three columns (no 4-column gap on desktop)', () => {
    render(<HomePage />)
    const heading = screen.getByRole('heading', { name: 'Financial Overview' })
    // The heading now shares a flex row with the duration selector (story 12-2),
    // so locate the stat grid from the enclosing section rather than the heading's
    // immediate parent.
    const grid = heading.closest('section')?.querySelector('div.grid')
    expect(grid).not.toBeNull()
    expect(grid?.className).toContain('md:grid-cols-3')
    expect(grid?.className).not.toContain('md:grid-cols-4')
    // Exactly three stat cards under the overview grid.
    expect(grid?.children.length).toBe(3)
  })
})

/**
 * Global income/expense duration selector (story 12-2, FR31).
 *
 * A single control on the Financial Overview re-expresses Total Income and Total
 * Expenses Weekly / Monthly / Annually, defaulting to Annually. The choice lives
 * in a persisted store (single source of truth), so it survives remount — one
 * control drives both figures with no per-card duplication.
 *
 * Currency mode defaults to `none`, so formatted amounts are `(cents/100).toFixed(2)`:
 * a monthly-normalized 120000c income → 14400.00 annually, 1200.00 monthly,
 * 276.92 weekly (120000 ÷ 52/12, rounded).
 */
describe('HomePage overview duration selector (story 12-2)', () => {
  function seedMonthly(): void {
    // Monthly amounts normalize 1:1, so raw === normalized (no InfoTooltip) and
    // the denormalized display values are exact and easy to reason about.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-monthly',
          userId: 0,
          name: 'Salary',
          amount: 120000,
          frequency: 'monthly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    useExpenseStore.setState({
      expenses: [
        {
          id: 'exp-monthly',
          userId: 0,
          name: 'Rent',
          amount: 60000,
          frequency: 'monthly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
  }

  function incomeCard(): HTMLElement {
    return screen
      .getByText(/^Total Income \(per (week|2 weeks|month|year)\)$/)
      .closest('div.surface-inset') as HTMLElement
  }

  function expenseCard(): HTMLElement {
    return screen
      .getByText(/^Total Expenses \(per (week|2 weeks|month|year)\)$/)
      .closest('div.surface-inset') as HTMLElement
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  it('AC-1: renders one selector defaulting to Annually, with annual card labels', () => {
    render(<HomePage />)

    const select = screen.getByRole('combobox', {
      name: /show income and expenses per/i,
    }) as HTMLSelectElement
    expect(select.value).toBe('annually')

    // Exactly one duration selector (no per-card duplication).
    expect(screen.getAllByRole('combobox', { name: /show income and expenses per/i })).toHaveLength(
      1
    )
    expect(screen.getByText('Total Income (per year)')).toBeInTheDocument()
    expect(screen.getByText('Total Expenses (per year)')).toBeInTheDocument()

    // Story 32.1 widened the control to the FOUR entry frequencies. Counting the
    // options pins that the rendered list and the store's coercion set agree —
    // a selectable option the store would reject on reload is the exact trap
    // this story was written to close.
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'weekly',
      'biweekly',
      'monthly',
      'annually',
    ])
  })

  it('AC-1/AC-2: figures start annual and re-express when the duration changes', () => {
    seedMonthly()
    render(<HomePage />)

    // Default: annual figures (monthly × 12). Currency-less mode groups
    // thousands (story 14-2), so 4+ digit figures carry a comma separator.
    expect(within(incomeCard()).getByText('14,400.00')).toBeInTheDocument()
    expect(within(expenseCard()).getByText('7,200.00')).toBeInTheDocument()

    // Switch to Monthly: labels and figures follow the one control.
    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'monthly' },
    })
    expect(screen.getByText('Total Income (per month)')).toBeInTheDocument()
    expect(within(incomeCard()).getByText('1,200.00')).toBeInTheDocument()
    expect(within(expenseCard()).getByText('600.00')).toBeInTheDocument()

    // Switch to Weekly: monthly ÷ (52/12), rounded to the cent.
    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'weekly' },
    })
    expect(screen.getByText('Total Income (per week)')).toBeInTheDocument()
    expect(within(incomeCard()).getByText('276.92')).toBeInTheDocument()
    expect(within(expenseCard()).getByText('138.46')).toBeInTheDocument()

    // Switch to Bi-weekly (story 32.1): monthly ÷ (26/12), rounded to the cent.
    //   income   round(120000 × 12/26) = round(55384.61…) = 55385 -> 553.85
    //   expenses round( 60000 × 12/26) = round(27692.30…) = 27692 -> 276.92
    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'biweekly' },
    })
    expect(screen.getByText('Total Income (per 2 weeks)')).toBeInTheDocument()
    expect(within(incomeCard()).getByText('553.85')).toBeInTheDocument()
    expect(within(expenseCard()).getByText('276.92')).toBeInTheDocument()
  })

  /**
   * ⚠️ Story 32.1 code review. The conversion disclosure used to be gated on
   * `totalNormalizedIncome !== totalIncomeRaw`. That equality is only a PROXY for
   * "conversion happened", and it has a false negative:
   *
   *   $330 weekly  -> round(33000 × 52/12) = 143000c
   *   $1,200 annually ->      round(120000/12) =  10000c
   *   normalized total                        = 153000c
   *   raw total       33000 + 120000          = 153000c   <- identical
   *
   * Both rows were genuinely converted, yet the old gate rendered no explanation.
   * The gate now asks whether any row is non-monthly. Reverting it leaves every
   * other test green, so this is the only assertion standing between that bug and
   * a release.
   */
  it('AC-2: discloses the conversion even when it lands coincidentally on the raw sum', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-weekly',
          userId: 0,
          name: 'Weekly',
          amount: 33000,
          frequency: 'weekly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
        {
          id: 'inc-annual',
          userId: 0,
          name: 'Annual',
          amount: 120000,
          frequency: 'annually',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    useExpenseStore.setState({ expenses: [] })
    render(<HomePage />)

    expect(
      screen.getByRole('button', { name: /more information about the income figure/i })
    ).toBeInTheDocument()
  })

  it('AC-2: shows no conversion disclosure when every row is already monthly', () => {
    seedMonthly()
    render(<HomePage />)

    expect(
      screen.queryByRole('button', { name: /more information about the income figure/i })
    ).not.toBeInTheDocument()
  })

  it('AC-3: the selection is a single source of truth that survives remount', () => {
    const { unmount } = render(<HomePage />)

    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'monthly' },
    })
    expect(
      (screen.getByRole('combobox', { name: /show income and expenses per/i }) as HTMLSelectElement)
        .value
    ).toBe('monthly')

    // Navigate away and back: a fresh mount reads the choice from the store.
    unmount()
    render(<HomePage />)
    const select = screen.getByRole('combobox', {
      name: /show income and expenses per/i,
    }) as HTMLSelectElement
    expect(select.value).toBe('monthly')
    expect(screen.getByText('Total Income (per month)')).toBeInTheDocument()
  })
})

/**
 * Income vs Expense Breakdown period control (story 12-3, UX-DR20; rebound to
 * the shared store by story 32.3).
 *
 * The six date-range presets are replaced with a period toggle defaulting to
 * Annually, and the chart re-aggregates through the core frequency engine
 * instead of summing raw amounts. Both of those guarantees are 12-3's and both
 * are still asserted below, unchanged.
 *
 * ⚠️ WHAT 32.3 CHANGED. This control used to hold its OWN component-local state,
 * independent of the overview duration selector (12-2), with no persistence.
 * That let the page show the same expenses twelve times apart on one screen —
 * the Total Expenses card on Monthly reading $2,441.67 while these pies, still on
 * their own Annually default, read $29,300.04. It now reads and writes the shared
 * `overviewDurationStore`, so there is exactly ONE period on the page and it
 * offers all FOUR durations. The two-option and independence claims below were
 * updated in place rather than deleted.
 *
 * ⚠️ `vitest.setup.ts` pins THIS SUITE to `{ mode: 'none', currency: 'NONE' }`,
 * so the breakdown figures print as locale-grouped decimals with no symbol
 * (story 14-2). That is the UNIT-test environment, NOT the product default —
 * new users get `$`/USD (FR38), which is what Playwright exercises. The older
 * wording here ("Currency mode defaults to `none`") read as an app-wide default
 * and is the exact ambiguity `e2e/breakdown-period.spec.ts` had to correct in
 * its own header; fixed in code review 32.3 so it is not copied onward.
 *
 * Seeding two income sources with EQUAL
 * raw amounts (10000c) but different frequencies proves normalization is
 * applied: a weekly entry and an annual entry must NOT render as equal slices.
 *   weekly  10000c → monthly round(10000 × 52/12) = 43333c → annually ×12 = 519996c → "5,199.96"
 *   annual  10000c → monthly round(10000 × 1/12) = 833c   → annually ×12 = 9996c   → "99.96"
 * Switching to Monthly divides each annual figure by 12: "433.33" and "8.33".
 */
describe('HomePage income-vs-expense breakdown period control (story 12-3)', () => {
  function seedMixedFrequencyIncome(): void {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-weekly',
          userId: 0,
          name: 'Weekly gig',
          amount: 10000,
          frequency: 'weekly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
        {
          id: 'inc-annual',
          userId: 0,
          name: 'Annual bonus',
          amount: 10000,
          frequency: 'annually',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
  }

  function breakdownSelect(): HTMLSelectElement {
    return screen.getByRole('combobox', { name: /show breakdown per/i }) as HTMLSelectElement
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  it('AC-1: offers the four shared durations, defaulting to Annually, with no preset labels', () => {
    seedMixedFrequencyIncome()
    render(<HomePage />)

    const select = breakdownSelect()
    expect(select.value).toBe('annually')

    // Four options since 32.3 — the same set the overview selector offers,
    // because both now render from VALID_DURATIONS.
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual(['weekly', 'biweekly', 'monthly', 'annually'])
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toEqual(['Weekly', 'Bi-weekly', 'Monthly', 'Annually'])

    // 12-3's ORIGINAL guarantee, unchanged: the old six-preset control and its
    // labels are gone. These must survive every later edit to this block.
    expect(screen.queryByText(/Last Month/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Last 3 Months/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Year to Date/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Custom Range/i)).not.toBeInTheDocument()
  })

  it('AC-2: category figures are frequency-normalized and re-express when the period changes', () => {
    seedMixedFrequencyIncome()
    render(<HomePage />)

    // Annually (default): equal raw amounts render as UNEQUAL, normalized slices.
    // Currency-less mode groups thousands (story 14-2): 519996c → "5,199.96".
    expect(screen.getByText('5,199.96')).toBeInTheDocument() // weekly 10000c/yr
    expect(screen.getByText('99.96')).toBeInTheDocument() // annual 10000c/yr
    // Not the raw sum — a raw-amount chart would show both as "100.00".
    expect(screen.queryByText('100.00')).not.toBeInTheDocument()

    // Switch to Monthly: each figure becomes the Annually value ÷ 12.
    fireEvent.change(breakdownSelect(), { target: { value: 'monthly' } })
    expect(breakdownSelect().value).toBe('monthly')
    expect(screen.getByText('433.33')).toBeInTheDocument() // 5,199.96 ÷ 12
    expect(screen.getByText('8.33')).toBeInTheDocument() // 99.96 ÷ 12
    // The annual figures are no longer shown.
    expect(screen.queryByText('5,199.96')).not.toBeInTheDocument()
    expect(screen.queryByText('99.96')).not.toBeInTheDocument()
  })

  /**
   * Story 32.3, AC-8/AC-10 — the ONE assertion that can fail if the breakdown
   * pies and the Total cards ever drift back onto two independent controls.
   *
   * ⚠️ It drives BOTH selectors, because the two failure modes are different
   * elements: reverting `periodScaledData` to a local `chartPeriod` breaks the
   * overview-selector direction, while rebinding the breakdown `<select>` to
   * local state breaks the breakdown-selector direction. Asserting only one
   * direction leaves the other mutation green.
   *
   * Figures for the mixed fixture (monthly-normalized 43,333c + 833c = 44,166c):
   *   annually  card 44,166 × 12 = 529,992c → "5,299.92"
   *   monthly   card 44,166c                → "441.66"
   * The pies scale per entry and, at these two INTEGRAL periods, sum to exactly
   * the same figure — which is what makes a shared value provable here.
   */
  it('AC-8: changing EITHER selector moves BOTH the overview card and the pies', () => {
    seedMixedFrequencyIncome()
    render(<HomePage />)

    const overviewSelect = () =>
      screen.getByRole('combobox', { name: /show income and expenses per/i }) as HTMLSelectElement
    const cardText = () => screen.getByTestId('overview-total-income').textContent
    // The pie's own total figure, scoped to the breakdown section so the card's
    // identical string cannot satisfy it.
    const breakdownSection = (): HTMLElement => {
      const section = screen
        .getByRole('heading', { name: 'Income vs Expense Breakdown' })
        .closest('section')
      if (!(section instanceof HTMLElement)) throw new Error('breakdown <section> not found')
      return section
    }

    // Both start at the shared default.
    expect(overviewSelect().value).toBe('annually')
    expect(breakdownSelect().value).toBe('annually')
    expect(cardText()).toContain('5,299.92')
    expect(within(breakdownSection()).getByText('5,299.92')).toBeInTheDocument()

    // Direction 1: drive the BREAKDOWN selector — the card must follow.
    fireEvent.change(breakdownSelect(), { target: { value: 'monthly' } })
    expect(overviewSelect().value).toBe('monthly')
    expect(cardText()).toContain('441.66')
    expect(within(breakdownSection()).getByText('441.66')).toBeInTheDocument()

    // Direction 2: drive the OVERVIEW selector — the pies must follow.
    fireEvent.change(overviewSelect(), { target: { value: 'annually' } })
    expect(breakdownSelect().value).toBe('annually')
    expect(cardText()).toContain('5,299.92')
    expect(within(breakdownSection()).getByText('5,299.92')).toBeInTheDocument()
  })

  it('AC-8: each pie title states the period, so it is never implicit (FR58)', () => {
    seedMixedFrequencyIncome()
    render(<HomePage />)

    expect(screen.getByText('Income by category (per year)')).toBeInTheDocument()
    expect(screen.getByText('Expenses by category (per year)')).toBeInTheDocument()

    fireEvent.change(breakdownSelect(), { target: { value: 'weekly' } })
    expect(screen.getByText('Income by category (per week)')).toBeInTheDocument()
    expect(screen.getByText('Expenses by category (per week)')).toBeInTheDocument()
  })

  /**
   * Story 32.3, AC-9 — the divergence this story CREATED must be disclosed.
   *
   * The pies scale each entry then sum; the Total cards sum monthly then scale
   * once. At ×12/52 and ×12/26 those disagree by a cent or two; at ×1 and ×12
   * they are exact. So the note must appear at exactly the two non-integral
   * periods and at neither integral one — an unconditional note would be false
   * half the time, and a `duration === 'weekly'` note would be the 32.1 rot again.
   */
  it('AC-9: the pies disclose per-entry rounding at weekly and biweekly only', () => {
    seedMixedFrequencyIncome()
    render(<HomePage />)

    // Annually (integral) — no note.
    expect(screen.queryByTestId('breakdown-pies-rounding-note')).not.toBeInTheDocument()

    fireEvent.change(breakdownSelect(), { target: { value: 'weekly' } })
    expect(screen.getByTestId('breakdown-pies-rounding-note')).toBeInTheDocument()

    // ⚠️ THE WORD "ENTRY" IS THE ASSERTION, not decoration. This note first read
    // "Each CATEGORY is rounded on its own" — which describes the /categories
    // page's per-bucket model, not what these pies do (they round each ENTRY,
    // then aggregate). Pinning only the note's PRESENCE let that wrong copy ship
    // and survive a mutation. Code review 32.3.
    expect(screen.getByTestId('breakdown-pies-rounding-note')).toHaveTextContent(
      /Each entry is rounded on its own/
    )
    expect(screen.getByTestId('breakdown-pies-rounding-note')).not.toHaveTextContent(
      /Each category is rounded/
    )
    // The magnitude is stated per entry, so it stays true as the list grows —
    // an unqualified "a few cents" is false for a 30-entry list (~15c).
    expect(screen.getByTestId('breakdown-pies-rounding-note')).toHaveTextContent(
      /about half a cent per entry/
    )

    fireEvent.change(breakdownSelect(), { target: { value: 'biweekly' } })
    expect(screen.getByTestId('breakdown-pies-rounding-note')).toBeInTheDocument()

    // Monthly (integral) — no note.
    fireEvent.change(breakdownSelect(), { target: { value: 'monthly' } })
    expect(screen.queryByTestId('breakdown-pies-rounding-note')).not.toBeInTheDocument()
  })

  /**
   * Story 32.3 code review — the note must not contradict the screen it sits on.
   *
   * ⚠️ THE FIX FOR THIS SHIPPED UNTESTED AND THE MUTATION SURVIVED. Reverting the
   * gate to `IS_NON_INTEGRAL_CADENCE[duration]` alone left the whole suite green,
   * which is the FOURTH consecutive story where a patch was applied without being
   * mutation-verified. These two cases are what make the gate real.
   *
   * The note claims figures "can differ from the totals above". That is only ever
   * true when a side has MORE THAN ONE entry for per-entry rounding to accumulate
   * across — with zero entries there are no figures at all, and with one the pie
   * total and the card are the same expression, `round(m / k)`.
   */
  it('AC-9: no rounding note when both pies are EMPTY (balances-only user)', () => {
    useBalanceStore.setState({
      entries: [
        {
          id: 'b1',
          type: 'investment',
          name: 'ISA',
          currentBalance: 500_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      ],
    })
    useOverviewDurationStore.setState({ duration: 'weekly' })
    render(<HomePage />)

    // The dashboard renders (hasData is true via balances) with two empty pies…
    expect(screen.getByText('No income to break down yet')).toBeInTheDocument()
    expect(screen.getByText('No expenses to break down yet')).toBeInTheDocument()
    // …so a note about figures differing would be describing nothing.
    expect(screen.queryByTestId('breakdown-pies-rounding-note')).not.toBeInTheDocument()

    useBalanceStore.setState({ entries: [] })
  })

  it('AC-9: no rounding note for a SINGLE entry, where divergence is impossible', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-only',
          userId: 0,
          name: 'Salary',
          amount: 10000,
          frequency: 'weekly',
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      ],
    })
    useOverviewDurationStore.setState({ duration: 'biweekly' })
    render(<HomePage />)

    // One entry: the pie total IS the card figure, by construction.
    expect(screen.queryByTestId('breakdown-pies-rounding-note')).not.toBeInTheDocument()
  })
})

/**
 * Asset & Liability breakdown pie removed (story 12-4, UX-DR21).
 *
 * The dashboard used to render an "Asset & Liability Breakdown" pie beside the
 * income-vs-expense pie, plotting Savings/Investments/Debts as three slices of
 * one whole. It was (a) redundant with the "Financial Category Summary" bar
 * chart directly below — the same three figures — and (b) conceptually muddled
 * (debts, a liability, shown as a proportional slice of an "asset" whole).
 * Product approved removing it; the bar chart is now the sole carrier of those
 * figures. These tests assert the asset pie is gone, the bar chart remains, and
 * the income/expense breakdown renders as two separate, distinctly-headed pies
 * (UX review #4 split it so each has its own correct 100% denominator).
 *
 * Assertions target the section/sub-headings, which render deterministically in
 * jsdom, rather than the Recharts SVG (which needs real layout to render).
 */
describe('HomePage asset/liability breakdown removed (story 12-4)', () => {
  function seedIncomeAndSavings(): void {
    // Income makes the visualization block render (hasData). A funded savings
    // goal is exactly the kind of figure the removed pie plotted, so seeding it
    // proves the pie is gone even when its data exists.
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          userId: 0,
          name: 'Salary',
          amount: 500000,
          frequency: 'monthly',
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 1,
          name: 'Emergency Fund',
          targetAmount: 1000000,
          currentBalance: 250000,
          createdAt: '2026-07-04T00:00:00.000Z',
          updatedAt: '2026-07-04T00:00:00.000Z',
        },
      ],
    })
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  afterEach(() => {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  })

  it('AC-3: the redundant "Asset & Liability Breakdown" pie and its heading are gone', () => {
    seedIncomeAndSavings()
    render(<HomePage />)
    expect(
      screen.queryByRole('heading', { name: /asset & liability breakdown/i })
    ).not.toBeInTheDocument()
  })

  it('AC-2: the "Financial Category Summary" bar chart remains as the sole carrier of the Savings/Investments/Debts figures', () => {
    seedIncomeAndSavings()
    render(<HomePage />)
    expect(screen.getByRole('heading', { name: /financial category summary/i })).toBeInTheDocument()
  })

  it('AC-2/UX-#4: income and expenses render as two separately-headed breakdown pies (asset & liability pie still gone)', () => {
    seedIncomeAndSavings()
    render(<HomePage />)
    // The section keeps its "Income vs Expense Breakdown" heading...
    expect(
      screen.getByRole('heading', { name: /income vs expense breakdown/i })
    ).toBeInTheDocument()
    // ...but income and expenses are now split into two sub-pies, each with its
    // own correct 100% denominator and a distinct sub-heading (UX review #4).
    // Retitled by story 30.4b: the pie groups by the user's own category now,
    // not per income source, so "by source" had become a lie.
    expect(screen.getByRole('heading', { name: /income by category/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /income by source/i })).toBeNull()
    expect(screen.getByRole('heading', { name: /expenses by category/i })).toBeInTheDocument()
    // The removed asset & liability pie stays gone.
    expect(screen.queryByRole('heading', { name: /asset & liability breakdown/i })).toBeNull()
  })
})

/**
 * Flows and balances split into two sub-charts (story UX-2).
 *
 * The "Financial Category Summary" used to plot per-period FLOWS (Income /
 * Expenses) on the same value axis as point-in-time BALANCES (Savings /
 * Investments / Debts). At the "Annually" cadence a ~$93.6k income bar dwarfed a
 * ~$5k savings balance, crushing the balance bars to a sliver. UX-2 splits the
 * section into two sub-charts — "Income & expenses" and "Balances" — each on its
 * own axis, so neither can flatten the other.
 *
 * Assertions target the section + sub-headings (which render deterministically in
 * jsdom), not the Recharts SVG (which needs real layout). The parent "Financial
 * Category Summary" heading is preserved as the carrier the story-12-4 tests
 * assert.
 */
describe('HomePage flows/balances split (story UX-2)', () => {
  const TS = '2026-07-14T00:00:00.000Z'

  function seedIncome(amountCents: number): void {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          userId: 0,
          name: 'Salary',
          amount: amountCents,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function seedExpense(amountCents: number): void {
    useExpenseStore.setState({
      expenses: [
        {
          id: 'exp-1',
          userId: 0,
          name: 'Rent',
          amount: amountCents,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function seedSavings(balanceCents: number): void {
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 1,
          name: 'Emergency Fund',
          targetAmount: 1000000,
          currentBalance: balanceCents,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function seedBalances(): void {
    useBalanceStore.setState({
      entries: [
        {
          id: 'inv-1',
          type: 'investment',
          name: '401k',
          currentBalance: 800000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
        {
          id: 'debt-1',
          type: 'debt',
          name: 'Car Loan',
          currentBalance: 300000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    })
  }

  function resetAll(): void {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    resetAll()
  })

  afterEach(resetAll)

  it('AC-1: renders separate "Income & expenses" and "Balances" sub-charts when both exist', () => {
    seedIncome(500000)
    seedExpense(200000)
    seedSavings(500000)
    seedBalances()
    render(<HomePage />)
    // The parent section heading is preserved (story-12-4 carrier guarantee).
    expect(screen.getByRole('heading', { name: /financial category summary/i })).toBeInTheDocument()
    // Flows and balances now have their own distinctly-headed sub-charts.
    expect(screen.getByRole('heading', { name: /^income & expenses/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^balances$/i })).toBeInTheDocument()
    // Both sections have data, so the empty fallback must not appear.
    expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
  })

  it('AC-2: the flows sub-heading carries the overview-duration suffix (not regressing #8)', () => {
    seedIncome(500000)
    seedExpense(200000)
    render(<HomePage />)
    // Default cadence (Annually) — the flows sub-heading reads "(per year)".
    expect(
      screen.getByRole('heading', { name: 'Income & expenses (per year)' })
    ).toBeInTheDocument()

    // Switching the ONE overview selector re-expresses the flows heading in
    // lockstep with the cards above (story 12-2 alignment).
    fireEvent.change(screen.getByRole('combobox', { name: /show income and expenses per/i }), {
      target: { value: 'monthly' },
    })
    expect(
      screen.getByRole('heading', { name: 'Income & expenses (per month)' })
    ).toBeInTheDocument()
    // The stale annual heading must be GONE (not merely joined by the monthly one)
    // — guards against a duplicate-render regression.
    expect(
      screen.queryByRole('heading', { name: 'Income & expenses (per year)' })
    ).not.toBeInTheDocument()
  })

  it('AC-5: a genuinely balances-only user (no income/expense rows) still reaches the Balances sub-chart', () => {
    // The real balances-only path — NO income or expense rows at all. This works
    // only because `hasData` counts savings/balances too (the ux-2 review fix);
    // before that, this user hit the "Let's set up your budget" onboarding and
    // never saw their balances. No zero-amount-income trick.
    seedSavings(250000)
    render(<HomePage />)
    // The onboarding screen must NOT show — the dashboard renders for this user.
    expect(screen.queryByText(/let's set up your budget/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^balances$/i })).toBeInTheDocument()
    // Flows are absent, so the flows sub-chart is hidden and no empty axis renders.
    expect(screen.queryByRole('heading', { name: /^income & expenses/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
  })

  it('AC-5: with only flows (no balances), the balances sub-chart is hidden', () => {
    seedIncome(500000)
    seedExpense(200000)
    render(<HomePage />)
    expect(screen.getByRole('heading', { name: /^income & expenses/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^balances$/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/no financial data to display/i)).not.toBeInTheDocument()
  })

  it('AC-5: with neither flows nor balances present, the section shows the empty hint', () => {
    // Income row exists (hasData → the summary section renders) but its amount is
    // zero and there are no balances, so both datasets are empty.
    seedIncome(0)
    render(<HomePage />)
    expect(screen.getByText(/no financial data to display/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^income & expenses/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^balances$/i })).not.toBeInTheDocument()
  })
})

/**
 * HomePage net-worth tests (Story 32.2, FR59).
 *
 * The Overview's "Net Worth" card now shows `investments + savings − debts`,
 * read through the one shared `useNetWorth()` hook, so it can no longer disagree
 * with the Balance page — or with the balances bar chart ten lines below it,
 * which has always plotted Savings + Investments − Debts.
 *
 * ⚠️ Expectations are HAND-COMPUTED from the story §3 fixture, in the suite-wide
 * currency-less mode:
 *
 *   2,000,000c investments + 300,000c savings − 15,000,000c debts = −12,700,000c
 *   the pre-32.2 formula gave −13,000,000c → "-130,000.00"
 *
 * The figure is located by `data-testid`, never by an accessible-name matcher:
 * story 32.1 measured that a heading/label containing an InfoTooltip button
 * resolves to a different accessible name under jsdom than under Chromium.
 */
describe('HomePage net worth includes savings (Story 32.2)', () => {
  const NW_TS = '2026-08-15T00:00:00.000Z'

  function resetAll(): void {
    useIncomeStore.setState({ incomeSources: [] })
    useExpenseStore.setState({ expenses: [] })
    useSavingsStore.setState({ savingsGoals: [] })
    useBalanceStore.setState({ entries: [] })
    useOverviewDurationStore.setState({ duration: 'annually' })
  }

  beforeEach(() => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: false })
    resetAll()
  })

  afterEach(resetAll)

  function seedSavings(): void {
    useSavingsStore.setState({
      savingsGoals: [
        {
          id: 'sav-1',
          name: 'Emergency fund',
          targetAmount: 1_000_000,
          currentBalance: 250_000,
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
        {
          id: 'sav-2',
          name: 'Rainy day',
          targetAmount: null,
          currentBalance: 50_000,
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
      ],
    })
  }

  function seedBalances(): void {
    useBalanceStore.setState({
      entries: [
        {
          id: 'inv-1',
          type: 'investment',
          name: 'ISA',
          currentBalance: 800_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
        {
          id: 'inv-2',
          type: 'investment',
          name: 'Pension',
          currentBalance: 1_200_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
        {
          id: 'debt-1',
          type: 'debt',
          name: 'Mortgage',
          currentBalance: 15_000_000,
          monthlyContribution: 0,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
      ],
    })
  }

  it('AC-3: adds savings into the Overview net-worth figure', () => {
    seedSavings()
    seedBalances()
    render(<HomePage />)

    expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('-127,000.00')
  })

  it('AC-3: no longer shows the pre-32.2 investments-minus-debts figure', () => {
    seedSavings()
    seedBalances()
    render(<HomePage />)

    expect(screen.getByTestId('overview-net-worth')).not.toHaveTextContent('-130,000.00')
  })

  it('AC-3: the net-worth tooltip names savings as a component', async () => {
    seedSavings()
    seedBalances()
    render(<HomePage />)

    // Progressive disclosure: the bubble exists only while the trigger is
    // focused/hovered, so focus it first (the story 11-4 pattern).
    const trigger = screen.getByRole('button', { name: /more information about net worth/i })
    fireEvent.focus(trigger)
    const tooltip = await screen.findByRole('tooltip')

    // Distinguishing phrasing, not a generic word (Epic 23 lesson): the copy has
    // to say savings count, and must no longer state the superseded definition
    // ("your investments minus your debts") as fact.
    expect(tooltip).toHaveTextContent(/savings/i)
    expect(tooltip).not.toHaveTextContent(/your investments minus your debts/i)
    // The Savings page is where that money is entered, so name it alongside Balance.
    expect(tooltip).toHaveTextContent(/balance/i)
  })

  it('AC-6: a savings-only user sees a positive net worth equal to their savings', () => {
    seedSavings()
    render(<HomePage />)

    expect(screen.getByTestId('overview-net-worth')).toHaveTextContent('3,000.00')
  })

  it('AC-3: a savings-only user is NOT told the figure is untracked', () => {
    seedSavings()
    render(<HomePage />)

    // The old gate keyed on balance rows alone, so this hint rendered beside a
    // real, positive net worth — the card contradicting itself.
    expect(screen.queryByTestId('net-worth-empty-hint')).not.toBeInTheDocument()
  })

  it('AC-3: a user with only flows still sees the hint, now naming both pages', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          name: 'Salary',
          amount: 500_000,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
      ],
    })
    render(<HomePage />)

    const hint = screen.getByTestId('net-worth-empty-hint')
    expect(hint).toBeInTheDocument()
    expect(hint.textContent).toMatch(/savings/i)
  })

  it('AC-6: shows zero, not NaN, with no balances and no savings', () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: 'inc-1',
          name: 'Salary',
          amount: 500_000,
          frequency: 'monthly',
          createdAt: NW_TS,
          updatedAt: NW_TS,
        },
      ],
    })
    render(<HomePage />)

    const netWorth = screen.getByTestId('overview-net-worth')
    expect(netWorth).toHaveTextContent('0.00')
    expect(netWorth.textContent).not.toMatch(/NaN/)
  })
})
