// `renderWithRouter` is required for PremiumPrompt only: its CTA is a TanStack
// Router <Link>, which throws "Cannot read properties of null (reading 'isServer')"
// without a router in scope. The other surfaces render no Link.
import { render, renderWithRouter, screen, within } from '@/test/utils'
import { describe, expect, it, vi } from 'vitest'
import { getDocPage } from '../../../content/docs'
import { PRICING_PAGE } from '../../../content/legal'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../../lib/premium/benefits'
import { PREMIUM_FEATURES as PROMPT_COPY } from '../../auth/premium-prompt'
import { PREMIUM_FEATURES as PRICING_COPY } from '../../pricing/pricing-page'

/**
 * Cross-surface Premium benefit-set parity (story 33.2, FR56, AC-4/AC-5).
 *
 * ## Why this file exists
 *
 * FR56 is a defect report about DRIFT, not about any one surface being wrong.
 * Epic 30 shipped three Premium capabilities; `/docs/features` was the only place
 * updated, so it listed five while `/pricing`, the upgrade prompt and the Overview
 * each listed a different rendering of "three" — and two source comments asserted
 * the set was "exactly these three". Every surface was guarded in isolation, so
 * nothing anywhere could see the disagreement. There was no parity test to extend:
 * before this file, no test in the repo imported two benefit surfaces at once.
 *
 * ## What actually enforces parity (and what this file adds)
 *
 * The primary guard is the TYPE SYSTEM, not this file. Each surface's copy is a
 * `Record<PremiumBenefitId, …>` keyed off `lib/premium/benefits.ts`, so omitting a
 * benefit is a compile error and inventing one is an excess-property error. That
 * covers the three TypeScript surfaces completely.
 *
 * This file adds the three things `tsc` cannot do:
 *   1. Catch a key set built past the type — an `as` cast, a spread, a dynamically
 *      assembled map. Asserted in BOTH directions, so an EXTRA key fails too.
 *   2. Prove the copy actually REACHES the DOM, one item per benefit. A map can be
 *      complete while the render drops or duplicates a row.
 *   3. Guard the two MARKDOWN surfaces, which have no types at all — one required
 *      anchor phrase per benefit.
 *
 * ## Counts are derived, never written
 *
 * Landing story 33.2 meant hunting six stale hard-coded 3s and 2s across four
 * files. Every count below comes from `PREMIUM_BENEFIT_IDS.length`, so the next
 * amendment to the set cannot leave a stale literal behind here.
 */

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

// Imported after the mock so HomePage picks it up (the file-level `vi.mock` is
// hoisted, but keeping the import here documents the dependency).
import { HomePage, OVERVIEW_BENEFITS } from '../../HomePage'
import { PremiumPrompt } from '../../auth/premium-prompt'
import { PricingPageView } from '../../pricing/pricing-page'

/** A resolved free-tier status: every benefit renders in its locked state. */
function mockFreeTier(): void {
  const status: PremiumAccessStatus = {
    hasAccess: false,
    subscriptionStatus: 'free',
    isLoading: false,
    error: null,
    isAuthenticated: true,
  }
  usePremiumAccess.mockReturnValue({ status })
}

/**
 * Markdown, lowercased and with all whitespace collapsed to single spaces.
 *
 * ⚠️ The collapse is load-bearing, not tidiness. Both `.md` sources are HARD-WRAPPED
 * at ~80 columns, so `pricing.md` really contains "advanced\nforecasting" and a
 * multi-word `toContain` matches nothing — it fails on the line break rather than on
 * the meaning. This is epic-23's recorded lesson and it bit again here on the first
 * run of this file.
 */
function flatten(markdown: string): string {
  return markdown.replace(/\s+/g, ' ').toLowerCase()
}

const FEATURES_MD = getDocPage('features')?.content ?? ''
const PRICING_MD = PRICING_PAGE.content

/**
 * The Premium half of `features.md` — everything after the `### Premium tier`
 * heading and before the next `###`. Lowercased, because these are prose anchors
 * and sentence casing is not the thing under test.
 *
 * Scoped rather than searched whole: several of these anchors (e.g. "custom
 * categories") would also match the Free tier list or the intro paragraph, and a
 * benefit accidentally documented under the wrong tier must fail, not pass.
 */
function premiumSectionOfFeaturesMd(): string {
  const start = FEATURES_MD.indexOf('### Premium tier')
  expect(start, 'features.md must still have a "### Premium tier" heading').toBeGreaterThan(-1)
  const rest = FEATURES_MD.slice(start + '### Premium tier'.length)
  const end = rest.indexOf('\n###')
  return flatten(end === -1 ? rest : rest.slice(0, end))
}

/**
 * The one-sentence tier summary in `pricing.md` — the paragraph between the
 * "_Last updated_" line and the first `###` heading.
 *
 * Scoped rather than searching the whole document, because the rest of the file
 * (billing, refunds, links) legitimately mentions Premium and could satisfy a
 * benefit anchor that the summary itself has lost.
 */
function summarySentenceOfPricingMd(): string {
  const afterDate = PRICING_MD.indexOf('_\n')
  const body = afterDate === -1 ? PRICING_MD : PRICING_MD.slice(afterDate + 2)
  const end = body.indexOf('\n###')
  const summary = flatten(end === -1 ? body : body.slice(0, end))
  expect(summary.length, 'pricing.md must still open with a tier summary').toBeGreaterThan(0)
  return summary
}

/**
 * One distinguishing phrase per benefit that each markdown surface must contain.
 *
 * ⚠️ These are `Record<PremiumBenefitId, …>` too, so a new benefit cannot be added
 * to the canonical set without someone deciding how the docs name it. That is
 * deliberate: the failure mode FR56 documents is a benefit shipping with the code
 * updated and the prose forgotten.
 *
 * `features.md` anchors are longer because that surface explains each benefit in a
 * sentence; `pricing.md` is a single summary sentence, so its anchors are the bare
 * names. Neither is a substring of an unrelated bullet — checked by mutation.
 */
const FEATURES_MD_ANCHORS: Record<PremiumBenefitId, string> = {
  sync: 'multi-device sync',
  forecasting: 'advanced forecasting',
  profiles: 'custom profiles',
  report: 'financial summary report',
  categories: 'custom categories',
}

const PRICING_MD_ANCHORS: Record<PremiumBenefitId, string> = {
  sync: 'multi-device sync',
  forecasting: 'advanced forecasting',
  profiles: 'custom profiles',
  report: 'financial summary report',
  // Names the breakdown, so AC-4 ("on EVERY surface") needs no exemption for this
  // file. Ratified at code review: four extra words keep the one-sentence form D5
  // requires, so `legal-content.test.ts`'s ban on a heading or bullet list here is
  // untouched — the alternative was exempting the surface, which weakens the AC.
  categories: 'custom categories with a per-category breakdown',
}

describe('the canonical Premium benefit set is the same on every surface', () => {
  it('has no duplicate ids and a stable order', () => {
    // Anti-vacuous: every count assertion below is derived from this array, so if
    // it were empty or duplicated the whole file would pass while proving nothing.
    expect(PREMIUM_BENEFIT_IDS.length).toBeGreaterThan(0)
    expect(new Set(PREMIUM_BENEFIT_IDS).size).toBe(PREMIUM_BENEFIT_IDS.length)
  })

  // ⚠️ Only the first three are SURFACES. The last two are this file's own anchor
  // fixtures, whose key sets `tsc` already guarantees — they are included so a
  // benefit added to the canonical set cannot land without someone deciding how the
  // two markdown surfaces name it, not because checking them proves anything about
  // shipped copy. Naming them "fixture" keeps the it.each title from overstating
  // what the matrix covers.
  it.each([
    ['pricing card (surface)', PRICING_COPY],
    ['upgrade prompt (surface)', PROMPT_COPY],
    ['overview section (surface)', OVERVIEW_BENEFITS],
    ['features.md anchors (fixture)', FEATURES_MD_ANCHORS],
    ['pricing.md anchors (fixture)', PRICING_MD_ANCHORS],
  ] as const)('%s covers exactly the canonical ids — no omission, no invention', (_name, copy) => {
    // Set equality in BOTH directions. `toEqual` on sorted arrays would also pass
    // for a map with the right count but a wrong key, which is why the two
    // directions are asserted separately with distinct failure messages.
    const keys = Object.keys(copy)
    for (const id of PREMIUM_BENEFIT_IDS) {
      expect(keys, `missing copy for the "${id}" benefit`).toContain(id)
    }
    for (const key of keys) {
      expect(
        PREMIUM_BENEFIT_IDS as readonly string[],
        `"${key}" is not a canonical benefit id`
      ).toContain(key)
    }
    expect(keys).toHaveLength(PREMIUM_BENEFIT_IDS.length)
  })

  it('states every benefit exactly once on the /pricing Premium card, in canonical order', () => {
    render(<PricingPageView />)
    const heading = screen.getByRole('heading', { name: 'Premium', level: 2 })
    const card = heading.closest('div')
    if (!card) throw new Error('No card container found for the Premium plan')

    const items = within(card).getAllByRole('listitem')
    expect(items).toHaveLength(PREMIUM_BENEFIT_IDS.length)
    // ⚠️ SEQUENCE, not just membership. `benefits.ts` calls itself the source of
    // truth for "which benefits and in WHAT ORDER", but until this assertion the
    // order half was pinned nowhere: reversing the tuple reordered this card, the
    // prompt and the Overview with the whole suite GREEN (131/131, mutation-proved
    // in the 33.2 review). Comparing the rendered text array in one shot is what
    // makes a reorder fail; per-item `getByText` cannot see position.
    expect(items.map((li) => li.textContent?.trim())).toEqual(
      PREMIUM_BENEFIT_IDS.map((id) => PRICING_COPY[id])
    )
  })

  it('states every benefit exactly once in the upgrade prompt, in canonical order (inline and dialog)', async () => {
    const expected = PREMIUM_BENEFIT_IDS.map((id) => PROMPT_COPY[id])

    const { unmount } = renderWithRouter(<PremiumPrompt />)
    const inline = await screen.findByRole('list')
    const inlineItems = within(inline).getAllByRole('listitem')
    expect(inlineItems).toHaveLength(PREMIUM_BENEFIT_IDS.length)
    expect(inlineItems.map((li) => li.textContent?.trim())).toEqual(expected)
    unmount()

    // Both render modes, because they are two different subtrees and only one of
    // them is what a locked feature actually shows the user.
    renderWithRouter(<PremiumPrompt asDialog onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog', { name: /go premium/i })
    const list = within(dialog).getByRole('list')
    const dialogItems = within(list).getAllByRole('listitem')
    expect(dialogItems).toHaveLength(PREMIUM_BENEFIT_IDS.length)
    expect(dialogItems.map((li) => li.textContent?.trim())).toEqual(expected)
  })

  it('points each openable benefit at its own route', () => {
    // ⚠️ WRITTEN OUT INDEPENDENTLY, and that is the entire point. Every other href
    // assertion in the suite derives its expected value from `OVERVIEW_BENEFITS`
    // itself — `HomePage.test.tsx` builds its route table by mapping over the same
    // record it is checking. Mutation-proved during story 33.2: swapping the
    // `/report` and `/categories` hrefs left the whole suite GREEN (78/78), because
    // a mutated map produces a mutated expectation that agrees with it perfectly.
    //
    // A guard derived from the thing it guards cannot fail. So this table restates
    // the pairing, and the duplication is deliberate: it is the only place a
    // benefit pointing at the wrong page can be caught.
    // `featureName` is pinned here too, for the same reason and one of its own:
    // it is what `PremiumFeatureGate` turns into the "<name> — premium, locked"
    // accessible name, and D4 requires one feature to have exactly ONE name across
    // the Overview, `/settings` and its route. Nothing compared those before, so
    // renaming `report.featureName` to "Financial Summary" stayed green while the
    // two surfaces announced different names — the drift class this story removes.
    const EXPECTED: Record<
      PremiumBenefitId,
      | { activation: 'prompt'; featureName: string }
      | { activation: 'route'; href: string; featureName: string }
    > = {
      // Activatable, but there is no /sync page — story 41.1, UX-DR45. Written
      // out here rather than derived precisely BECAUSE a boolean would have hidden
      // this case: "not openable" used to mean both "no page" and "does nothing",
      // and only one of those is still true.
      sync: { activation: 'prompt', featureName: 'Multi-device sync' },
      forecasting: {
        activation: 'route',
        href: '/forecasting',
        featureName: 'Advanced Forecasting',
      },
      profiles: { activation: 'route', href: '/profiles', featureName: 'Custom Profiles' },
      report: { activation: 'route', href: '/report', featureName: 'Financial Summary Report' },
      categories: { activation: 'route', href: '/categories', featureName: 'Custom Categories' },
    }

    for (const id of PREMIUM_BENEFIT_IDS) {
      const benefit = OVERVIEW_BENEFITS[id]
      const expected = EXPECTED[id]
      expect(benefit.activation, `"${id}" is in the wrong activation state`).toBe(
        expected.activation
      )
      if (expected.activation === 'prompt') {
        // The negative half, and the one that matters: an activatable benefit with
        // no page must not acquire an href by drifting into the 'route' arm.
        expect(benefit, `"${id}" has no page, so it must carry no href`).not.toHaveProperty('href')
        if (benefit.activation === 'prompt') {
          expect(benefit.featureName, `"${id}" announces the wrong name`).toBe(expected.featureName)
        }
        continue
      }
      if (benefit.activation === 'route') {
        expect(benefit.href, `"${id}" links to the wrong page`).toBe(expected.href)
        expect(benefit.featureName, `"${id}" announces the wrong name`).toBe(expected.featureName)
      }
    }
  })

  it('renders one badged box per benefit on the Overview, in canonical order', () => {
    mockFreeTier()
    render(<HomePage />)

    // SEQUENCE on this surface too. The e2e cannot carry it: `premium-locked.spec.ts`
    // builds its node list as `[sync-box, ...gates]`, which forces sync first by
    // construction, so even sync losing its lead position is invisible there.
    const stack = screen.getByRole('heading', { name: 'Premium Features' }).nextElementSibling
    expect(stack, 'the Premium Features stack must follow its heading').not.toBeNull()
    const rendered = [...(stack?.children ?? [])].map((box) => box.textContent ?? '')
    expect(rendered).toHaveLength(PREMIUM_BENEFIT_IDS.length)
    for (const [index, id] of PREMIUM_BENEFIT_IDS.entries()) {
      const { container, unmount } = render(OVERVIEW_BENEFITS[id].label())
      const title = container.querySelector('span')?.textContent ?? ''
      unmount()
      expect(title.length, `"${id}" must render a non-empty title`).toBeGreaterThan(0)
      expect(rendered[index], `box ${index} should be the "${id}" benefit`).toContain(title)
    }

    // One box per benefit, each carrying a lock badge (UX-DR39's rule, extended by
    // 33.2 from three boxes to the whole canonical set).
    expect(screen.getAllByText('Premium')).toHaveLength(PREMIUM_BENEFIT_IDS.length)

    // …and since story 41.1 every activatable benefit is a gate, which for a free
    // user is all of them.
    const activatable = PREMIUM_BENEFIT_IDS.filter(
      (id) => OVERVIEW_BENEFITS[id].activation !== 'none'
    )
    expect(screen.getAllByTestId('premium-gate-locked')).toHaveLength(activatable.length)

    // ⚠️ REWRITTEN, NOT DROPPED. Until 41.1 this loop asserted that the unopenable
    // benefits render as STATIC boxes, "so the badge count above cannot be
    // satisfied by gates alone" — a discriminator that dissolves once every box is
    // a gate. The claim that still discriminates is the one UX-DR45 preserved:
    // a benefit with no page must carry no page affordance, whatever it activates.
    for (const id of PREMIUM_BENEFIT_IDS) {
      if (OVERVIEW_BENEFITS[id].activation === 'route') continue
      // Only a routeless benefit carries a `premium-benefit-<id>` testid — the
      // routed ones are addressed through the gate. Reaching this line for a
      // routed id would throw, which is the intended failure if the arms drift.
      const box = screen.getByTestId(`premium-benefit-${id}`)
      expect(within(box).queryByRole('link'), `"${id}" has no page to link to`).toBeNull()
      expect(within(box).queryByText('Open →'), `"${id}" has no page to open`).toBeNull()
    }
  })

  it('documents every benefit under the Premium tier in features.md', () => {
    const premium = premiumSectionOfFeaturesMd()
    for (const id of PREMIUM_BENEFIT_IDS) {
      expect(premium, `features.md's Premium section never mentions "${id}"`).toContain(
        FEATURES_MD_ANCHORS[id]
      )
    }
  })

  it('names every benefit in the pricing.md summary sentence', () => {
    // ⚠️ This surface had NO guard at all before story 33.2 — it enumerated three
    // benefits in prose and nothing would have noticed it going stale, which is
    // precisely how it came to disagree with `features.md`.
    //
    // Anchors only, deliberately: `legal-content.test.ts` forbids this file from
    // re-acquiring a "### Premium" heading or a bulleted feature list (story 20-4's
    // de-dup rule), so the assertion must not push it toward becoming one.
    //
    // ⚠️ Scoped to the SENTENCE, not the document. The first version searched all of
    // `pricing.md`, so a benefit dropped from the summary would still pass if its
    // name appeared anywhere else in the file — the identical slice-imprecision trap
    // this same change diagnoses and fixes in `featureSections()`. Diagnosing a trap
    // in one file while committing it in another is how it stays alive.
    const summary = summarySentenceOfPricingMd()
    for (const id of PREMIUM_BENEFIT_IDS) {
      expect(summary, `pricing.md's summary sentence never names the "${id}" benefit`).toContain(
        PRICING_MD_ANCHORS[id]
      )
    }
  })

  it('enumerates the full Premium set in the features.md intro', () => {
    // ⚠️ This exists because `docs-content.test.ts`'s tier-placement negatives were
    // RESCOPED (`free` → `freeTier`) on the stated grounds that "FR56 requires the
    // intro to enumerate the whole Premium set". Weakening a guard to permit a
    // requirement, and then pinning that requirement nowhere, is the worst version of
    // the trade: deleting ", a financial summary report, and custom categories" from
    // the intro left docs + parity at 57/57 GREEN.
    //
    // The intro is the slice ABOVE `### Free tier`; the parity anchors elsewhere in
    // this file cover only the `### Premium tier` section, which excludes it.
    const intro = flatten(FEATURES_MD.slice(0, FEATURES_MD.indexOf('### Free tier')))
    expect(
      intro.length,
      'features.md must still have an intro above "### Free tier"'
    ).toBeGreaterThan(0)
    for (const id of PREMIUM_BENEFIT_IDS) {
      expect(intro, `the features.md intro never names the "${id}" benefit`).toContain(
        FEATURES_MD_ANCHORS[id]
      )
    }
  })
})

describe('the benefit copy claims only what ships', () => {
  /**
   * One benefit's user-visible text, **per surface** — never concatenated.
   *
   * ⚠️ THIS SHAPE IS THE FIX FOR A SURVIVING MUTATION, and the reason matters more
   * than the code. The first version returned the three surfaces JOINED into one
   * string. Every assertion below then read as if it covered all three, but a
   * positive like `toMatch(/breakdown|totals/)` was satisfied by ANY one of them:
   * deleting ", and see what each category totals" from the Overview's label left
   * the suite at **79/79 GREEN**, even though `HomePage.tsx`'s own docblock calls
   * that phrase "the only thing carrying FR54's second half on this surface".
   *
   * A joined haystack turns a per-surface claim into an existential one. Returning
   * a labelled record forces every check below to say which surface it means, and
   * `assertEverySurface` fails with the surface named.
   */
  function copyBySurface(id: PremiumBenefitId): Record<string, string> {
    const Label = OVERVIEW_BENEFITS[id].label
    const { container, unmount } = render(<Label />)
    const overview = container.textContent ?? ''
    unmount()
    // Anti-vacuous: an empty haystack passes every `not.toMatch` silently. The
    // Overview strand is the one that was invisible before, so prove it is real.
    expect(overview.length, `the Overview renders no text for "${id}"`).toBeGreaterThan(0)
    return {
      '/pricing': PRICING_COPY[id].toLowerCase(),
      'upgrade prompt': PROMPT_COPY[id].toLowerCase(),
      Overview: overview.toLowerCase(),
    }
  }

  /** Assert a predicate holds on EVERY surface's copy for a benefit, named. */
  function assertEverySurface(
    id: PremiumBenefitId,
    check: (copy: string, surface: string) => void
  ): void {
    for (const [surface, copy] of Object.entries(copyBySurface(id))) {
      check(copy, surface)
    }
  }

  it('never claims the summary report covers retirement, projections or charts', () => {
    // FR53's OWN wording says "budget, net worth, and retirement outlook", but
    // story 30-3 formally narrowed the shipped report: retirement and
    // forward-projection inputs are ephemeral `useState` with no persistence, so
    // there is nothing to report on, and the report renders no charts. The code is
    // authoritative over the requirement text here.
    assertEverySurface('report', (copy, surface) =>
      expect(copy, `${surface} overclaims the report's scope`).not.toMatch(
        /retirement|projection|chart/
      )
    )
  })

  it('never calls the summary report a backup or something re-importable', () => {
    // It is a document to read or keep. `features.md` says so explicitly; no other
    // surface may imply otherwise.
    assertEverySurface('report', (copy, surface) =>
      expect(copy, `${surface} calls the report a backup`).not.toMatch(
        /backup|back up|re-?import|restore/
      )
    )
  })

  it('never claims the app itself generates or downloads the PDF', () => {
    // The button calls `window.print()`. Any PDF comes from the user's own browser
    // print dialog — "save … as a PDF from your browser" is true, "generate a PDF"
    // or "download your report" is not.
    assertEverySurface('report', (copy, surface) =>
      expect(copy, `${surface} attributes the PDF to the app`).not.toMatch(
        /generates? a pdf|download/
      )
    )
  })

  it('never claims categories sync across devices', () => {
    // ⚠️ The hardest fence in this story. `lib/sync/syncBridge.ts` hard-pins
    // `categoryId: null` on every outgoing row, so categories and their
    // assignments never reach the server at all. Story 30-5 states the rule as an
    // absolute: no copy anywhere may claim they sync. `docs-content.test.ts` bans
    // the same wording from the features.md bullet; this extends the ban to the
    // three code surfaces, which had no such guard.
    assertEverySurface('categories', (copy, surface) =>
      expect(copy, `${surface} claims categories sync`).not.toMatch(
        /sync|across (?:all )?your devices|other devices|phone to laptop/
      )
    )
  })

  it('never claims categories apply to savings or balances', () => {
    // Only `incomeSources` and `expenses` carry a `categoryId`.
    assertEverySurface('categories', (copy, surface) =>
      expect(copy, `${surface} extends categories beyond income and expenses`).not.toMatch(
        /savings|balances|investments|debts/
      )
    )
  })

  it('never claims the category figures match the overview', () => {
    // They can diverge by cents at weekly/biweekly cadences: the overview pies
    // denormalize per entry, `/categories` per bucket. An open divergence, so no
    // surface may promise agreement.
    assertEverySurface('categories', (copy, surface) =>
      expect(copy, `${surface} promises the figures agree`).not.toMatch(
        /match|same as|identical|agree/
      )
    )
  })

  it('names the category breakdown on EVERY surface, not just the ability to create categories', () => {
    // AC-4. The manager and the breakdown share one route, so they are ONE benefit
    // entry — which makes this copy the only thing carrying FR54's second half.
    //
    // ⚠️ THE MUTATION THAT SURVIVED. The first version of this test checked the two
    // string surfaces individually and then the JOINED copy, which meant the
    // Overview was never really checked: deleting ", and see what each category
    // totals" from `CategoriesFeatureLabel` left the suite at 79/79 GREEN. An
    // assertion that says "every surface" must iterate surfaces and name the one
    // that failed — otherwise "folding two capabilities into one entry lets half the
    // requirement disappear silently" is exactly what the test permits.
    assertEverySurface('categories', (copy, surface) =>
      expect(copy, `${surface} never names the per-category breakdown`).toMatch(/breakdown|totals/)
    )
  })

  it('never reintroduces free or universal features as Premium perks', () => {
    // Dark mode is free (25-3); ad-freeness is universal (25-1); "coming soon"
    // padding was removed by 25-3. Checked on every surface of every benefit.
    for (const id of PREMIUM_BENEFIT_IDS) {
      assertEverySurface(id, (copy, surface) =>
        expect(copy, `${surface} sells "${id}" on a free or universal feature`).not.toMatch(
          /dark mode|no ads|coming soon/
        )
      )
    }
  })

  it('never claims a side-by-side comparison of two saved forecasts', () => {
    // No such view exists — only baseline-vs-scenario within a single forecast.
    assertEverySurface('forecasting', (copy, surface) =>
      expect(copy, `${surface} promises a side-by-side comparison`).not.toMatch(
        /side[\s-]by[\s-]side/
      )
    )
  })
})
