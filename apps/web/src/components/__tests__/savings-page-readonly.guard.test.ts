/**
 * `/savings` never writes to the balance store (Story 47.1, FR73, AC-8).
 *
 * ## Why this is a source sweep and not a runtime test
 *
 * Story 47.1 removed the per-line checkboxes from the Savings leftover breakdown.
 * They were the ONLY thing on `/savings` that mutated a `balanceTracking` row, so
 * the page is now a read-only view of rows the Balance Tracking page owns.
 *
 * ⚠️ A `vi.spyOn(…, 'updateBalanceEntry')` assertion CANNOT protect this. With the
 * control gone, no test interaction triggers a write, so the spy is green against
 * both the fixed code and code that has quietly regrown a write path. The only
 * assertion that fails when the shape comes back is one that reads the source.
 *
 * ## ⚠️ This sweep reads the RAW source. It does NOT strip comments — deliberately.
 *
 * The first version of this guard shipped a character-scanner stripper, copied from
 * `stores/__tests__/no-method-selectors.guard.test.ts`, on the stated rationale that
 * `SavingsPage.tsx` "documents the removal in a comment that names the very symbol
 * this guard bans". **Code review found that rationale was false.** No banned token
 * appears in any comment in that file — the documentation says "writes to the
 * balance store", which is prose, not an identifier. Stripping was never
 * load-bearing here, and the test that claimed to prove otherwise proved nothing.
 *
 * Worse, the stripper was measurably WRONG in the dangerous direction. It blanked
 * template-literal `${…}` interpolations as if they were string content, but they
 * are executable code. Measured during review: putting `updateBalanceEntry` inside
 * `` `breakdown-contribution-${…}` `` — and `SavingsPage.tsx` is full of such
 * literals — left this guard GREEN. Over-blanking makes the ban pass vacuously,
 * which is the one failure mode a guard must not have.
 *
 * Scanning raw source removes that entire class of bug. The cost is the opposite,
 * SAFE failure: if someone later writes one of these identifiers into a comment,
 * this test goes red for a reason a human resolves in seconds. A false alarm you
 * can see beats a silent miss you cannot.
 *
 * ## ⚠️ WHAT THIS GUARD DOES NOT DO
 *
 * `useInvestmentEntries` is NOT banned and must never be. It is the page's READ
 * path. AC-5 makes `/savings` read-only, not balance-blind — a guard that banned it
 * would turn the page's own data source into a violation.
 *
 * It is a single-FILE sweep. A write routed through an imported helper that wraps
 * `updateBalanceEntry` under another name is invisible to it. Recorded in
 * `deferred-work.md`; this is a tripwire, not a proof.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SAVINGS_PAGE = join(__dirname, '..', 'SavingsPage.tsx')

/**
 * Every identifier that would let this page write to the balance store.
 *
 * ⚠️ `useBalanceStore` is a FORWARD guard: the page does not name it today, and it
 * is the obvious way a future write path would be reintroduced. It is also a READ
 * capability, so a legitimate future direct-selector read would trip this ban. That
 * is a deliberate trade — see `deferred-work.md`.
 */
const WRITE_PATHS = ['updateBalanceEntry', 'useBalanceActions', 'useBalanceStore']

describe('SavingsPage — no balance-store writes (Story 47.1, AC-8)', () => {
  it('names no balance-store write path anywhere in the file', () => {
    const source = readFileSync(SAVINGS_PAGE, 'utf8')
    for (const symbol of WRITE_PATHS) {
      expect(source).not.toContain(symbol)
    }
  })

  it('still names its READ path — the guard must not have banned the data source', () => {
    // Acceptance partner. Without it, a guard pointed at the wrong path (or at an
    // empty string) passes vacuously and reports the page clean forever.
    const source = readFileSync(SAVINGS_PAGE, 'utf8')
    expect(source).toContain('useInvestmentEntries')
    expect(source).toContain('solveAutomaticAllocations')
  })

  it('scans template-literal interpolations, where a write would most plausibly hide', () => {
    // ⚠️ THE REGRESSION GUARD FOR THIS GUARD'S OWN BUG. The stripped version of this
    // sweep blanked `${…}` as string content and went green on exactly this shape.
    // `SavingsPage.tsx` builds most of its test ids this way, so it is where a
    // reintroduced write is likeliest to sit.
    const source = readFileSync(SAVINGS_PAGE, 'utf8')
    expect(source).toMatch(/`[^`]*\$\{/) // the file really does use interpolations
    const interpolations = source.match(/\$\{[^}]*\}/g) ?? []
    expect(interpolations.length).toBeGreaterThan(0)
    for (const fragment of interpolations) {
      for (const symbol of WRITE_PATHS) {
        expect(fragment).not.toContain(symbol)
      }
    }
  })
})
