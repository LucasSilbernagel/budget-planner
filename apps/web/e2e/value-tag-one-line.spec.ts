import { type Page, expect, test } from '@playwright/test'
import { seedFinanceRows } from './helpers/seed-finance-rows'

/**
 * Story 42.3 / UX-DR47 — a cell's value and its adjacent tag stay on one line
 * at 320px.
 *
 * ## ⚠️ Why every line-count assertion here uses a Range and not the element
 *
 * `el.getClientRects().length === 1` DOES NOT DETECT THIS WRAP. Measured on the
 * pre-fix code: the amount span reported ONE element rect while its text
 * occupied TWO lines. The span is a flex item, and a flex item is blockified —
 * `getClientRects()` on a block returns a single border-box rect no matter how
 * many lines the text takes.
 *
 * The Epic-18 note ("assert NO-WRAP via `getClientRects().length === 1`") is
 * valid for INLINE boxes only; batch-6 already recorded it inverting on a `<p>`.
 * The in-page `lineCount` helpers below use `Range.selectNodeContents`, which
 * returns one rect per rendered line. An assertion written the element way
 * passes on the broken code and looks like a working guard.
 *
 * ## ⚠️ Why the font is pinned
 *
 * CI resolves `system-ui` to DejaVu Sans; a typical dev box resolves it to the
 * narrower Noto Sans. Every width and line-count number below is a DejaVu
 * number. This is how epic 34 shipped green with a broken 768px width budget.
 * Re-declared per spec rather than shared, per the convention at
 * `premium-locked.spec.ts:280-281`.
 *
 * ## Positive control
 *
 * Run with the production fix stashed, this file reddens on AC-1 (amount 2
 * lines), AC-2 (badge 4 lines) and AC-3 (widest amount 3 lines). If it does
 * not, the font override did nothing and every number here is from the wrong
 * host.
 */
const WIDE_FONT = '* { font-family: "DejaVu Sans" !important }'

const NARROW = { width: 320, height: 900 }

async function openNarrow(page: Page, route: string): Promise<void> {
  await page.setViewportSize(NARROW)
  // ⚠️ `theme` is REQUIRED. Omitting it writes `{state:{}}` to the theme key and
  // the store silently falls back to light — an accidental theme pin rather than
  // a chosen one. `e2e/` is not type-checked (tsconfig.app.json is `src/**`
  // only), so nothing catches the dropped argument; code review did.
  await seedFinanceRows(page, 'light')
  await page.goto(route)
  await page.addStyleTag({ content: WIDE_FONT })
  await page.waitForLoadState('networkidle')
  // ⚠️ Rows render client-side from seeded localStorage, so `networkidle` alone
  // races hydration: a slow mount makes the in-page `querySelector` return null
  // and the spec throws. Loud rather than silent, but flaky — wait for a row.
  await expect(page.locator('tbody tr').first()).toBeVisible()
}

test.describe('Story 42.3 — value and tag on one line at 320px', () => {
  // AC-1: the headline defect. Pre-fix these read 2 lines / different lines.
  test('AC-1 the Monthly Allocation amount and its pill share one line', async ({ page }) => {
    await openNarrow(page, '/savings')

    // ⚠️ Ids are hardcoded, so assert the fixture still has exactly these rows —
    // otherwise a third seeded row would be silently unchecked, which is the
    // "[0] indexing" hole in a different costume.
    const rowIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="savings-allocation-mode-"]')).map((el) =>
        (el.getAttribute('data-testid') ?? '').replace('savings-allocation-mode-', '')
      )
    )
    expect(rowIds.sort()).toEqual(['sav-1', 'sav-2'])

    for (const id of rowIds) {
      const m = await page.evaluate((goalId) => {
        const lineCount = (el: Element): number => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return range.getClientRects().length
        }
        const amount = document.querySelector(`[data-testid="savings-allocation-${goalId}"]`)
        const pill = document.querySelector(`[data-testid="savings-allocation-mode-${goalId}"]`)
        if (!amount || !pill) {
          throw new Error(`row ${goalId} rendered no amount/pill pair`)
        }
        const amountRect = amount.getBoundingClientRect()
        const pillRect = pill.getBoundingClientRect()
        return {
          text: amount.textContent?.trim() ?? '',
          pill: pill.textContent?.trim() ?? '',
          amountLines: lineCount(amount),
          pillLines: lineCount(pill),
          topDelta: Math.abs(amountRect.top - pillRect.top),
        }
      }, id)

      expect(
        m.amountLines,
        `${id}: amount "${m.text}" wrapped onto ${m.amountLines} lines at 320px (pre-fix: 2). The fix is whitespace-nowrap on the AMOUNT and on the TAG. Do NOT reach for the cell's max-sm:whitespace-normal / [overflow-wrap:anywhere] — three SEPARATE mutations each blew the 240px wrapper open: dropping a cell token, ~1134px (recorded in ResponsiveTable.tsx); nowrap on the NAME, 1185px (arm M3); dropping max-sm:whitespace-normal, 1212px (arm M5).`
      ).toBe(1)

      // "Goal" once rendered one character per line — the tag needs its own guard.
      expect(m.pillLines, `${id}: pill "${m.pill}" broke onto ${m.pillLines} lines`).toBe(1)

      // Without this, a "fix" that pushes the pill onto its own row underneath
      // still satisfies the line-count check above.
      expect(
        m.topDelta,
        `${id}: amount and pill are on different lines (top delta ${m.topDelta}px; pre-fix: a full line height)`
      ).toBeLessThan(2)
    }
  })

  // AC-2: the fix must not have been bought by reverting the wrapping contract.
  test('AC-2 a long unbroken name still wraps, and its badge stays intact', async ({ page }) => {
    await openNarrow(page, '/savings')

    const m = await page.evaluate(() => {
      const lineCount = (el: Element): number => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return range.getClientRects().length
      }
      const badge = document.querySelector('[data-testid="savings-badge-sav-1"]')
      const pair = badge?.parentElement
      const nameSpan = pair?.firstElementChild
      // ⚠️ The WIDEST tag in this table is "Account" (7 chars), and it sits on
      // sav-2. Checking only sav-1's 4-char "Goal" would leave the widest tag
      // unmeasured at any layer.
      const widestBadge = document.querySelector('[data-testid="savings-badge-sav-2"]')
      if (!badge || !nameSpan || !widestBadge) {
        throw new Error('the savings name cells rendered no name/badge pair')
      }
      return {
        nameLines: lineCount(nameSpan),
        badgeLines: lineCount(badge),
        badgeWidth: Math.round(badge.getBoundingClientRect().width),
        badgeText: badge.textContent?.trim() ?? '',
        widestBadgeLines: lineCount(widestBadge),
        widestBadgeWidth: Math.round(widestBadge.getBoundingClientRect().width),
        widestBadgeText: widestBadge.textContent?.trim() ?? '',
      }
    })

    // ⚠️ The name is unbounded user free text (no maxLength on the input), so it
    // MUST keep wrapping. `whitespace-nowrap` on the NAME is the ~1134px revert
    // the module forbids. Only the BADGE is protected.
    expect(
      m.nameLines,
      `the 138-character seeded name collapsed to ${m.nameLines} line(s). If this is 1, whitespace-nowrap reached the NAME as well as the tag — that reverts the 320px card layout. Protect the tag, never the free-text value.`
    ).toBeGreaterThan(1)

    // Pre-fix the four-letter badge "Goal" rendered on 4 lines at 25px wide.
    expect(m.badgeLines, `badge "${m.badgeText}" broke onto ${m.badgeLines} lines`).toBe(1)
    expect(
      m.badgeWidth,
      `badge "${m.badgeText}" was crushed to ${m.badgeWidth}px, 16px of which is px-2 padding (pre-fix: 25px)`
    ).toBeGreaterThan(30)

    // Measured: "Account" is 64px on one line.
    expect(
      m.widestBadgeLines,
      `the widest badge "${m.widestBadgeText}" broke onto ${m.widestBadgeLines} lines`
    ).toBe(1)
    expect(m.widestBadgeWidth).toBeGreaterThan(30)
  })

  // AC-3: assert against the widest amount a 320px viewport can produce, not a
  // short fixture that would fit either way.
  test('AC-3 the widest amount that fits still renders on one line', async ({ page }) => {
    await openNarrow(page, '/savings')

    // ⚠️ A WIDTH PROBE, not a data assertion: the text is substituted in place
    // so the guard measures the ceiling rather than only the seeded figure.
    // Measured (DejaVu, 320px, USD): $987,654,321.00 (15 chars, pair 175px)
    // fits; $9,876,543,210.00 (17 chars, pair 189px) overflows the cell, because
    // max-sm:justify-between serves the "Monthly Allocation" label first and
    // crushes it to ~21px. Recorded beside the constant in ResponsiveTable.tsx.
    // ⚠️ THE BOUND IS CURRENCY-SPECIFIC, and USD is the narrowest common case.
    // CHF formats the same figure as `CHF 987'654'321.00` — 18 chars, already
    // past the tip — so a CHF user reaches it around $98M, roughly an order of
    // magnitude lower. The seed pins USD, so no test here covers that.
    // Do NOT widen this fixture without re-measuring that ceiling.
    const WIDEST_THAT_FITS = '$987,654,321.00'

    const m = await page.evaluate((widest) => {
      const lineCount = (el: Element): number => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return range.getClientRects().length
      }
      const amount = document.querySelector('[data-testid="savings-allocation-sav-1"]')
      const pill = document.querySelector('[data-testid="savings-allocation-mode-sav-1"]')
      const cell = amount?.closest('td')
      if (!amount || !pill || !cell) {
        throw new Error('the savings allocation cell did not render')
      }
      const seededText = amount.textContent?.trim() ?? ''
      amount.textContent = widest
      const amountRect = amount.getBoundingClientRect()
      const pillRect = pill.getBoundingClientRect()
      const out = {
        seededText,
        amountLines: lineCount(amount),
        topDelta: Math.abs(amountRect.top - pillRect.top),
        cellOverflow: cell.scrollWidth > cell.clientWidth,
      }
      amount.textContent = seededText
      return out
    }, WIDEST_THAT_FITS)

    // The seeded figure must itself be wide enough to have reproduced the bug.
    expect(
      m.seededText.length,
      `the seeded allocation "${m.seededText}" is too short to prove anything — it must be wide enough to wrap on the pre-fix code`
    ).toBeGreaterThanOrEqual(11)

    expect(m.amountLines, `"${WIDEST_THAT_FITS}" wrapped onto ${m.amountLines} lines`).toBe(1)
    expect(m.topDelta).toBeLessThan(2)
    expect(
      m.cellOverflow,
      `"${WIDEST_THAT_FITS}" overflowed its cell — the measured ceiling has moved. Re-measure it and update the comment in ResponsiveTable.tsx; do not delete this assertion.`
    ).toBe(false)
  })

  // AC-4: the audit, codified. These three cells hold a pill with NO sibling
  // value. ⚠️ They render on one line because nothing COMPETES for the width —
  // NOT because their min-content floor holds: they carry no tag class, so the
  // cell's inherited `overflow-wrap: anywhere` still drops their floor to about
  // one character, exactly as it did to the "Goal" badge. Add a sibling value to
  // any of these cells and it reproduces the story's defect. Measured
  // already-correct today; these guards keep them that way.
  // ⚠️ Widest labels: `/income` and `/expenses` render the RAW enum, where
  // `biweekly` and `annually` tie at 8 characters (measured 76px in a 222px
  // cell); `/balance` renders a label, widest `Investment` at 93px.
  for (const { route, widest, label } of [
    { route: '/income', widest: 'biweekly', label: 'Frequency' },
    { route: '/expenses', widest: 'biweekly', label: 'Frequency' },
    { route: '/balance', widest: 'Investment', label: 'Type' },
  ]) {
    test(`AC-4 ${route} lone ${label} pill stays on one line`, async ({ page }) => {
      await openNarrow(page, route)

      const m = await page.evaluate((widestLabel) => {
        const lineCount = (el: Element): number => {
          const range = document.createRange()
          range.selectNodeContents(el)
          return range.getClientRects().length
        }
        const pills = Array.from(
          document.querySelectorAll<HTMLElement>('td:has(> span.rounded-full) span.rounded-full')
        )
        const first = pills[0]
        if (!first) {
          throw new Error('this route rendered no tag pills')
        }
        // EVERY pill, not just [0] — 42.2's review found exactly that hole.
        const seeded = pills.map((pill) => ({
          text: pill.textContent?.trim() ?? '',
          lines: lineCount(pill),
        }))
        const original = first.textContent
        first.textContent = widestLabel
        const widestCase = { text: widestLabel, lines: lineCount(first) }
        first.textContent = original
        return { seeded, widestCase }
      }, widest)

      for (const pill of m.seeded) {
        expect(pill.lines, `${route}: pill "${pill.text}" broke onto ${pill.lines} lines`).toBe(1)
      }
      expect(
        m.widestCase.lines,
        `${route}: the widest label "${m.widestCase.text}" broke onto ${m.widestCase.lines} lines`
      ).toBe(1)
    })
  }

  // AC-5: the fix must not buy one-line rendering with horizontal overflow.
  // ⚠️ This is where `whitespace-nowrap` lands when it is applied too widely —
  // the M3 arm (nowrap on the name) tripped it at 1185 against 240.
  test('AC-5 no horizontal overflow is introduced at 320px', async ({ page }) => {
    await openNarrow(page, '/savings')

    const m = await page.evaluate(() => {
      const table = document.querySelector('table')
      const wrapper = table?.closest('div.overflow-x-auto')
      if (!wrapper) {
        throw new Error('the savings table sits in no scroll wrapper')
      }
      const doc = document.documentElement
      return {
        wrapperScrollWidth: wrapper.scrollWidth,
        wrapperClientWidth: wrapper.clientWidth,
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
      }
    })

    // Measured baseline AND post-fix: 240 === 240.
    expect(
      m.wrapperScrollWidth,
      `the wrapper overflowed (${m.wrapperScrollWidth} > ${m.wrapperClientWidth}) — whitespace-nowrap trades a wrap defect for an overflow defect, and this is where that lands`
    ).toBe(m.wrapperClientWidth)
    // Measured: 320 === 320.
    expect(m.docScrollWidth).toBe(m.docClientWidth)
  })
})
