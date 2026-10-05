import { describe, expect, it } from 'vitest'
import { LEGAL_PAGES, PRICING_PAGE, PRIVACY_PAGE, getLegalPage } from '../index'

/**
 * Legal/commercial content registry tests (story 5-13, updated in stories 10-3,
 * 25-2, 5-20).
 *
 * Confirms the registry exposes the four Paddle-required pages with well-formed
 * bodies loaded from the static `.md` files, that slug lookup behaves, that the
 * pricing page carries the Merchant-of-Record disclosure and the finalized EUR
 * pricing (€5.99/mo + €39/yr + €99 lifetime — the monthly plan added by story
 * 5-20, which reversed 25-2's annual-only decision), and that no unresolved
 * DRAFT/placeholder tokens remain (10-3 AC-1).
 */
describe('LEGAL_PAGES', () => {
  it('exposes the pricing, terms, privacy, and refund pages', () => {
    const slugs = LEGAL_PAGES.map((page) => page.slug)
    expect(slugs).toEqual(expect.arrayContaining(['pricing', 'terms', 'privacy', 'refund']))
  })

  it('gives every page a slug, title, description, and non-empty markdown body', () => {
    for (const page of LEGAL_PAGES) {
      expect(page.slug).toMatch(/^[a-z0-9-]+$/)
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.description.length).toBeGreaterThan(0)
      expect(page.content.trim().length).toBeGreaterThan(0)
    }
  })

  it('uses unique slugs', () => {
    const slugs = LEGAL_PAGES.map((page) => page.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('keeps the route header as the single h1: no body-level h1, at least one h2', () => {
    for (const page of LEGAL_PAGES) {
      // The route header owns the only `<h1>`; bodies must not introduce another.
      expect(page.content).not.toMatch(/^# .+/m)
      // …but each body still has structured h2 sections.
      expect(page.content).toMatch(/^## .+/m)
    }
  })

  it('never opens a body with a heading that just repeats the page title', () => {
    for (const page of LEGAL_PAGES) {
      const firstHeading = page.content.match(/^#{2,6} (.+)$/m)?.[1]?.trim()
      expect(firstHeading).not.toBe(page.title)
    }
  })

  it('contains no unresolved DRAFT banner or bracketed placeholder (10-3 AC-1)', () => {
    for (const page of LEGAL_PAGES) {
      expect(page.content).not.toMatch(/DRAFT — pending legal review/)
      expect(page.content).not.toMatch(/\[(?:DATE|PRICE|CONFIRM)\b[^\]]*\]/)
    }
  })

  it('refers to the product as "Longhand Budget", never the retired brands (stories 27-3, brand-1)', () => {
    // The legal rebrand must be complete and stay complete: no legal body or its
    // index metadata may reference a retired wordmark as the CURRENT name, while
    // preserving the surrounding legal grammar (defined terms, parentheticals).
    for (const page of LEGAL_PAGES) {
      expect(page.content).not.toContain('Budget Planner')
      expect(page.description).not.toContain('Budget Planner')
      // brand-1: no legal page description may still carry the retired brand.
      expect(page.description).not.toContain('SoluBudget')
    }
    expect(getLegalPage('terms')?.content).toContain('Longhand Budget')
    expect(getLegalPage('terms')?.description).toContain('Longhand Budget')
  })

  /**
   * brand-1 AC-5 — every legal page carries a visible last-updated date.
   *
   * AC-5 originally also required a "formerly named SoluBudget" note in each
   * document, on the rationale that "existing customers can reconcile the
   * change". That rationale was void: the app has never been deployed (the
   * launch-gate stories 4-16 / 5-3 / 5-6 are all still ready-for-dev), so there
   * are no existing customers and SoluBudget was never a public brand. Those
   * notes were dropped at code review — they would have published a former name
   * to an audience that never saw it, and they were the ONLY reason AC-2 could
   * not be satisfied literally. AC-2 now holds with no exception, enforced
   * repo-wide by `src/__tests__/retired-brand.test.ts`.
   */
  it('every legal page carries a visible last-updated date (AC-5)', () => {
    for (const page of LEGAL_PAGES) {
      expect(page.content).toMatch(/_Last updated: \d{1,2} \w+ \d{4}_/)
    }
  })
})

describe('getLegalPage', () => {
  it('returns the matching page for a known slug', () => {
    expect(getLegalPage('privacy')?.title).toBe('Privacy Policy')
  })

  it('returns undefined for an unknown slug', () => {
    expect(getLegalPage('does-not-exist')).toBeUndefined()
  })
})

/**
 * Story 73.1 — the privacy policy states a retention period for lapsed
 * accounts (FR115). The period is a COMMITMENT, not a description of a running
 * job: the purge is story 73.2, and no account can come due before 2027-09-10
 * (production went live 2026-09-10), which is the only reason "we will delete"
 * is true today. So the section must not describe an automatic process.
 *
 * Every assertion is scoped to the section, and most to a single bullet, so a
 * phrase moved into the wrong bullet (an exemption turned into a deletion
 * trigger) goes red. The extractors THROW when a heading or bullet is missing,
 * so no assertion can pass against an empty string.
 */
describe('privacy page: retention period (story 73.1)', () => {
  const RETENTION_HEADING = /^## How long we keep your data$/gm

  function retentionSection(): string {
    const content = PRIVACY_PAGE.content
    // Anchored to a whole line, so a demoted `### How long…` does not count,
    // and required exactly once, so a second, contradicting section cannot hide
    // behind the first.
    const headings = [...content.matchAll(RETENTION_HEADING)]
    if (headings.length !== 1) {
      throw new Error(`privacy.md must have exactly one retention h2, found ${headings.length}`)
    }
    const rest = content.slice((headings[0].index ?? 0) + headings[0][0].length)
    const next = rest.search(/^## /m)
    return next === -1 ? rest : rest.slice(0, next)
  }

  function bullet(label: string): string {
    const found = retentionSection()
      .split(/^- /m)
      .find((item) => item.startsWith(`**${label}**`))
    if (found === undefined) {
      throw new Error(`retention section has no "${label}" bullet`)
    }
    return found
  }

  it('states the 12-month period and the 30-day notice, and no other duration', () => {
    // EVERY duration the section states must be 12 months — or, since story
    // 73.2, the 30 days of the warning's lead time and the deletion bound
    // (`server/retention/sweep.ts`, NOTICE_LEAD_MS). A bare
    // `toMatch(/12 months/)` stayed green when one of the two mentions was
    // changed to 24 (control run in story 73.1), and a digits-plus-"months"
    // pattern missed "12 years", "a year" and "twelve months" (73.1 review).
    const section = retentionSection().replaceAll('*', '')
    const durations = [
      ...section.matchAll(
        /\b(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty[\s-]four)[\s-]+(day|week|month|year)s?\b/gi
      ),
    ].map((match) => `${match[1].toLowerCase()} ${match[2].toLowerCase()}`)
    expect(durations).toContain('12 month')
    expect(durations).toContain('30 day')
    expect(
      durations.every((duration) => duration === '12 month' || duration === '30 day'),
      `durations stated: ${durations}`
    ).toBe(true)
  })

  it('exempts every entitled account in the Premium bullet: active, payment retried, lifetime', () => {
    const premium = bullet('While you have Premium')
    expect(premium).toMatch(/as long as your Premium access continues/)
    expect(premium).toMatch(/payment is being retried/)
    // A lifetime purchase CAN be revoked (refund or chargeback sets `canceled`,
    // webhooks/paddle.ts handleAdjustment), so "never lapses" would be false.
    expect(premium).toMatch(/lifetime license \(unless the purchase is refunded or charged back\)/)
  })

  it('states the trigger, the clock and the commitment in the lapse bullet', () => {
    const lapsed = bullet('After Premium access ends')
    // Any loss of access, not only a subscription ending: a revoked lifetime
    // lands in the same `canceled` state 73.2 will select.
    expect(lapsed).toMatch(/if your Premium access ends/)
    expect(lapsed).toMatch(/a purchase is refunded or charged back/)
    // Story 73.2: a paused subscription maps to `free`, which the purge
    // selects (`server/retention/status-classes.ts`), so the policy says so.
    expect(lapsed).toMatch(/your subscription ends or is paused/)
    // Buying lifetime also stops the clock, and it is not a "resubscription".
    expect(lapsed).toMatch(/you do not buy Premium again/)
    // D1 (Lucas, 2026-09-27): the clock runs from the end of access, and a
    // sign-in does not reset it.
    expect(lapsed).toMatch(/from the day your access ended/)
    expect(lapsed).toMatch(/Signing in during that time does not reset the 12 months/)
    // The commitment itself, future tense. The self-service bullet also says
    // "delete your account and all of your synced data", so pin the "we will".
    expect(lapsed).toMatch(/we will delete your account and all of your synced data/)
    // Story 73.2: the lead time (D2) and the upper bound, both 30 days.
    expect(lapsed).toMatch(/We will email you at least 30 days before that happens/)
    // "normally": an account whose warning keeps failing is never deleted
    // unwarned, so it can run past the bound (review decision, Lucas 2026-09-28).
    expect(lapsed).toMatch(/normally within 30 days of the 12 months ending/)
    expect(lapsed).not.toMatch(/payment is being retried|lifetime license/)
  })

  it('says, in the Premium sync section, that the retirement plan is synced (story 99.3, D8)', () => {
    // 99.3 is the first story where a plan reaches the server, and it holds the
    // most personal figures in the app, so the policy names them.
    const content = PRIVACY_PAGE.content
    const start = content.search(/^## Premium tier: EU-hosted sync$/m)
    expect(start, 'privacy.md has no "## Premium tier: EU-hosted sync" section').toBeGreaterThan(-1)
    const next = content.slice(start + 1).search(/^## /m)
    const section = content.slice(start, next === -1 ? undefined : start + 1 + next)
    expect(section).toContain(
      'The synced data includes your retirement plan (your age, your life expectancy and the retirement income you want).'
    )
  })

  it('covers the Premium account and its synced data, not the free tier', () => {
    const section = retentionSection()
    // The account row (email, Paddle customer id) is personal data too, and it
    // is deleted with the synced data, so the scope names both.
    expect(section).toMatch(/covers your Premium account and the data it syncs/)
    expect(section).toMatch(/Free-tier data stays on your device/)
  })

  it('points a lapsed user at self-service deletion, and the section it cites exists after it', () => {
    const self = bullet("You don't have to wait")
    expect(self).toMatch(/at any time from Settings/)
    expect(self).toMatch(/see "Your rights" below/)
    const content = PRIVACY_PAGE.content
    const rights = content.search(/^## Your rights$/m)
    expect(rights, 'privacy.md has no "## Your rights" section').toBeGreaterThan(
      content.search(RETENTION_HEADING)
    )
  })

  // 73.1 wrote this guard because no purge existed yet. Story 73.2 KEEPS it:
  // the policy states what we commit to, not how a job achieves it, and a
  // word like "daily" would turn an ops cadence into a public promise.
  it('states commitments, not the mechanism that carries them out', () => {
    expect(retentionSection()).not.toMatch(
      /\b(automatic(ally)?|automated|auto-?delet\w*|scheduled|nightly|daily|weekly|periodic(ally)?|cron|job|every (night|day|week|month))\b|our system deletes/i
    )
  })
})

describe('pricing page content (AC-4)', () => {
  it('discloses Paddle as the Merchant of Record', () => {
    expect(PRICING_PAGE.content).toMatch(/Paddle/)
    expect(PRICING_PAGE.content).toMatch(/Merchant of Record/i)
  })

  it('states the finalized EUR pricing — three plans (stories 25-2, 5-20)', () => {
    expect(PRICING_PAGE.content).toMatch(/€39 per year/)
    expect(PRICING_PAGE.content).toMatch(/€99/)
    expect(PRICING_PAGE.content).toMatch(/lifetime/i)

    // ⚠️ Story 5-20 REVERSED story 25-2's "no monthly" decision, so the negative
    // this assertion used to carry (`not.toMatch(/per month/)`) is INVERTED, not
    // deleted — coverage moves rather than dropping. 25-2's arithmetic was never
    // disputed (monthly is the least fee-efficient plan); the reversal is on
    // trial-to-paid conversion grounds for an unproven product.
    expect(PRICING_PAGE.content).toMatch(/€5\.99 per month/)

    // The €39 and €99 figures are PINNED and must not be raised — the 2026-09-16
    // market research confirmed both against budgeting-app comparables and
    // recommended explicitly against raising either. €5.99 is likewise chosen so
    // €39/yr reads as a visible saving; the saving claim is stated on the page.
    // Derived, not a literal — see the sibling assertion in pricing-page.test.tsx.
    const savingPct = Math.round((1 - 39 / (5.99 * 12)) * 100)
    expect(PRICING_PAGE.content).toMatch(new RegExp(`${savingPct}% cheaper`))

    // The never-shipped €10/mo figure from the pre-25-2 drafts stays banned.
    expect(PRICING_PAGE.content).not.toMatch(/€10\b/)
  })

  it('de-duplicates the plan comparison — prose carries billing/legal only, not the card feature lists (story 20-4, CONTENT-L)', () => {
    // Story 20-4: the scannable Free/Premium feature lists + prices live in the
    // PlanCards (pricing-page.tsx). This prose keeps only the uniquely-carried
    // billing/legal detail, so the plan/benefit info is stated once, not twice.
    expect(PRICING_PAGE.content).toMatch(/### Billing & payments/)
    // The duplicated tier feature-list sections are gone…
    expect(PRICING_PAGE.content).not.toMatch(/### Free/)
    expect(PRICING_PAGE.content).not.toMatch(/### Premium/)
    // …including the phrases that introduced the duplicated bullet lists.
    expect(PRICING_PAGE.content).not.toMatch(/Everything in Free, plus/i)
    expect(PRICING_PAGE.content).not.toMatch(/Track income, expenses/i)
  })

  it('keeps forecasting benefit detail out of the prose (stories 20-1, 20-4, 30-2)', () => {
    // Both negatives stay, but the reason has changed and is worth stating.
    // Story 20-1 banned "reloadable" because saved forecasts genuinely could not
    // be reopened; story bug-3 then shipped reload, so that premise is dead and
    // the sibling guards in docs-content/pricing-page were inverted to pin the
    // claim instead (story 30-2). Here the negatives survive on DIFFERENT
    // grounds: story 20-4 de-duplicated the tier feature lists out of pricing.md
    // so the prose carries billing and legal matter only. Benefit detail — the
    // reload claim included — belongs on the Premium card and in features.md,
    // not here.
    //
    // ⚠️ Scope note (30-2 review): this assertion bans only the ADJECTIVE. Since
    // `reload` ⊂ `reloadable`, prose saying "reload your saved forecasts" passes
    // here. That broader de-dup rule is enforced elsewhere, by the page-wide
    // getAllByText(/reload/i) count in pricing-page.test.tsx, which renders this
    // prose. Story 30-2 AC-5 froze THIS assertion byte-identical, so the comment
    // is narrowed to what it truly guarantees rather than the assertion widened.
    expect(PRICING_PAGE.content).not.toMatch(/reloadable/i)

    // "side by side" is additionally still a real overpromise: no view plots two
    // saved forecasts together. Hyphenated form included (30-2 review).
    expect(PRICING_PAGE.content).not.toMatch(/side[\s-]by[\s-]side/i)
  })
})

describe('privacy page: the retention warning email is disclosed (story 73.2)', () => {
  it('names the retention warning in the Brevo section, and still only the address', () => {
    const content = PRIVACY_PAGE.content
    const start = content.search(/^## Sign-in and account emails$/m)
    expect(start, 'privacy.md has no "## Sign-in and account emails" section').toBeGreaterThan(-1)
    const rest = content.slice(start + 1)
    const section = rest.slice(0, rest.search(/^## /m))
    expect(section).toMatch(/Brevo/)
    expect(section).toMatch(/warning before a lapsed account is deleted/)
    expect(section).toMatch(/only the email address/)
    expect(section).toMatch(/never receives your financial data/)
  })
})

/**
 * Story 95.1 (FR154): the theme is no longer stored (story 61.1 deleted the theme
 * store; it follows `prefers-color-scheme`), so the privacy policy must not say it
 * is saved. Scoped to the Display-preferences bullet, and it must NOT claim currency
 * is the ONLY thing stored locally (other UI preferences are).
 */
describe('privacy page: display preferences (story 95.1)', () => {
  function displayPreferencesBullet(): string {
    const lines = PRIVACY_PAGE.content
      .split('\n')
      .filter((line) => line.startsWith('- **Display preferences**'))
    expect(lines, 'privacy.md must have exactly one Display preferences bullet').toHaveLength(1)
    return lines[0] ?? ''
  }

  it('says the currency choice is saved and the theme follows the device', () => {
    const bullet = displayPreferencesBullet()
    expect(bullet).toMatch(/currency\s+choice\s+is\s+saved\s+locally/i)
    expect(bullet).toMatch(/theme\s+simply\s+follows\s+your\s+device's\s+setting/i)
    expect(bullet).toMatch(/nothing\s+is\s+stored\s+for\s+it/i)
  })

  it('no longer claims the theme is saved, nor that currency is the only thing saved', () => {
    const bullet = displayPreferencesBullet()
    expect(bullet).not.toMatch(/theme\s+and\s+currency\s+choices\s+are\s+saved/i)
    expect(bullet).not.toMatch(/only\s+(your\s+)?currency/i)
  })
})
