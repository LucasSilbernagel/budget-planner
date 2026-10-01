import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderWithRouter, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { Footer } from '../components/layout/Footer'
import { type CssRule, GLOBAL_CSS, cssRules, selectorsOf } from '../test/css-rules'

/**
 * The print stylesheet, below the browser (was `e2e/report-print.spec.ts`,
 * story 30-3, FR53; moved by story 84.5, FR137).
 *
 * The e2e original emulated print media and read COMPUTED colours. jsdom has no
 * cascade and no print media, so this pins the RULES that produced those
 * colours, read with the same brace-aware walk as `pre-paint-suppression`:
 *
 *   - the report subtree is forced to dark ink, inside `@media print` ONLY
 *     (so a dark-themed report never prints near-white text, and the screen is
 *     never forced to black);
 *   - app chrome opts OUT of paper by `[data-print-hide]`, never by a bare
 *     `footer` (an in-page `<footer>` carries content: the forecasting page's
 *     EU data-location disclosure);
 *   - nothing in the print block reaches a page other than the report: no
 *     `html` / `body` / bare-element rule (an earlier revision forced
 *     black-on-white document-wide and silently changed every printed page).
 *
 * ⚠️ What is NOT pinned (the named D2 loss, Lucas 2026-10-01): the PAINTED
 * colour under real print media, and that `!important` wins over every token
 * class on every descendant. jsdom cannot evaluate either.
 */

const ROOT_SOURCE = readFileSync(resolve(__dirname, '..', 'routes', '__root.tsx'), 'utf-8')
const REPORT = '#financial-summary-report'

/**
 * Inside a media query that APPLIES to print: `@media print`, `@media only
 * print`, `@media screen, print`, `@media print and (…)` (84.5 code review,
 * MEASURED: a `^@media\s+print` prefix test classed the last three as screen).
 * `not print` is excluded.
 */
const isPrint = (rule: CssRule) =>
  rule.atRules.some((at) => /^@media\b(?![^{]*\bnot\s+print\b)[^{]*\bprint\b/.test(at))
/** A selector scoped to the report: the id itself, not a longer id that starts with it. */
const inReport = (selector: string) => /^#financial-summary-report(?![\w-])/.test(selector)
/** A selector that reaches the report anywhere, e.g. `.preview #financial-summary-report *`. */
const reachesReport = (selector: string) => /#financial-summary-report(?![\w-])/.test(selector)
const printRules = () => cssRules(GLOBAL_CSS).filter(isPrint)
const screenRules = () => cssRules(GLOBAL_CSS).filter((rule) => !isPrint(rule))

/** The LAST value of `property` in a rule body (the last declaration wins). */
function lastValue(body: string, property: string): string | undefined {
  const re = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g')
  return [...body.matchAll(re)].map((m) => (m[1] as string).trim()).at(-1)
}

describe('print rules: the report prints as dark ink (was e2e report-print:64, :96)', () => {
  it('forces the report AND every descendant to black, !important, inside @media print', () => {
    const hits = printRules().filter((rule) => {
      const selectors = selectorsOf(rule)
      return selectors.includes(REPORT) && selectors.includes(`${REPORT} *`)
    })
    expect(hits, 'no @media print rule covers the report and its subtree').toHaveLength(1)
    const body = (hits[0] as CssRule).body
    // Descendants each set their own token colour, so an ancestor rule alone
    // loses to them; `!important` on the subtree is what wins (both themes).
    expect(lastValue(body, 'color')).toBe('#000 !important')
    expect(lastValue(body, 'background-color')).toBe('transparent !important')
  })

  it('never forces the report colour on SCREEN: no rule outside @media print targets it', () => {
    const leaks = screenRules().filter((rule) => selectorsOf(rule).some(reachesReport))
    expect(
      leaks.map((rule) => rule.selector),
      'a report colour rule outside @media print would break dark mode on screen'
    ).toEqual([])
  })
})

describe('print rules: only chrome is suppressed (was e2e report-print:114, :169)', () => {
  it('hides [data-print-hide] with display: none, inside @media print only', () => {
    const hits = printRules().filter((rule) => selectorsOf(rule).includes('[data-print-hide]'))
    expect(hits).toHaveLength(1)
    expect(lastValue((hits[0] as CssRule).body, 'display')).toBe('none !important')

    const onScreen = screenRules().filter((rule) =>
      selectorsOf(rule).some((selector) => selector.includes('[data-print-hide]'))
    )
    expect(
      onScreen.map((rule) => rule.selector),
      'chrome hidden on screen too'
    ).toEqual([])
  })

  it('the global Footer and the root header wrapper opt in with data-print-hide', async () => {
    renderWithRouter(<Footer />)
    expect(await screen.findByRole('contentinfo')).toHaveAttribute('data-print-hide')

    // The root header wrapper is pinned on the source (`__root.tsx` is a route
    // module, not a component this file can mount): the attribute sits on an
    // element that is still OPEN when `<GlobalNav` is reached.
    const attr = ROOT_SOURCE.search(/\n\s*data-print-hide\n/)
    const nav = ROOT_SOURCE.indexOf('<GlobalNav', attr)
    expect(attr, 'no data-print-hide attribute in __root.tsx').toBeGreaterThan(-1)
    expect(nav, 'no <GlobalNav after the data-print-hide wrapper').toBeGreaterThan(attr)
    // ⚠️ Depth, not a count comparison (84.5 code review, MEASURED: with
    // `closes <= opens`, closing the wrapper and opening two unmarked divs
    // before `<GlobalNav />` stayed green). Walk the wrapper's own tag from the
    // attribute to `<GlobalNav`, JSX comments removed; it must never close.
    const tag = /<([a-z][\w-]*)\s*$/.exec(ROOT_SOURCE.slice(0, attr))?.[1]
    expect(tag, 'the data-print-hide attribute is not on an opening tag').toBeDefined()
    const between = ROOT_SOURCE.slice(attr, nav).replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    let depth = 1
    for (const m of between.matchAll(new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, 'g'))) {
      if (m[0].startsWith('</')) depth--
      else if (m[1] !== '/') depth++
      expect(depth, 'the data-print-hide wrapper closes before <GlobalNav>').toBeGreaterThan(0)
    }
  })

  it('suppresses nothing by bare element: no `footer` selector in the print block', () => {
    const bare = printRules().filter((rule) =>
      // A bare element outside the report (a report-scoped `footer` rule is the
      // report's own business); `(?![\w-])` so `footer-note` is not one.
      selectorsOf(rule).some(
        (selector) => !inReport(selector) && /(^|[\s>+~])footer(?![\w-])/.test(selector)
      )
    )
    expect(bare.map((rule) => rule.selector)).toEqual([])
  })
})

describe('print rules: other pages print untouched (was e2e report-print:132)', () => {
  it('every print selector is the chrome hook or inside the report: no html/body/global rule', () => {
    // Positive control: the walk found the print block at all.
    expect(printRules().length).toBeGreaterThan(0)
    const strays = printRules()
      .flatMap(selectorsOf)
      .filter((selector) => selector !== '[data-print-hide]' && !inReport(selector))
    expect(strays, 'a print rule reaches outside the report').toEqual([])
  })
})
