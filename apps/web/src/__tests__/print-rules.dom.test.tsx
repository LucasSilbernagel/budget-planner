import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderWithRouter, screen } from '@/test/utils'
import { describe, expect, it } from 'vitest'
import { Footer } from '../components/layout/Footer'
import { type CssRule, GLOBAL_CSS, cssRules, selectorsOf } from '../test/css-rules'

// jsdom has no cascade or print media, so this pins the print RULES, not painted colours.

const ROOT_SOURCE = readFileSync(resolve(__dirname, '..', 'routes', '__root.tsx'), 'utf-8')
const REPORT = '#financial-summary-report'

// `@media print`, `only print`, `screen, print`, `print and (…)`; `not print` excluded.
const isPrint = (rule: CssRule) =>
  rule.atRules.some((at) => /^@media\b(?![^{]*\bnot\s+print\b)[^{]*\bprint\b/.test(at))
const inReport = (selector: string) => /^#financial-summary-report(?![\w-])/.test(selector)
const reachesReport = (selector: string) => /#financial-summary-report(?![\w-])/.test(selector)
const printRules = () => cssRules(GLOBAL_CSS).filter(isPrint)
const screenRules = () => cssRules(GLOBAL_CSS).filter((rule) => !isPrint(rule))

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

    // `__root.tsx` is a route module, so it is pinned on source: the attribute's element must
    // still be OPEN when `<GlobalNav` is reached.
    const attr = ROOT_SOURCE.search(/\n\s*data-print-hide\n/)
    const nav = ROOT_SOURCE.indexOf('<GlobalNav', attr)
    expect(attr, 'no data-print-hide attribute in __root.tsx').toBeGreaterThan(-1)
    expect(nav, 'no <GlobalNav after the data-print-hide wrapper').toBeGreaterThan(attr)
    // Depth, not a count comparison: closing the wrapper and opening two unmarked divs keeps
    // the counts green.
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
      // `(?![\w-])` so `footer-note` is not a bare element.
      selectorsOf(rule).some(
        (selector) => !inReport(selector) && /(^|[\s>+~])footer(?![\w-])/.test(selector)
      )
    )
    expect(bare.map((rule) => rule.selector)).toEqual([])
  })
})

describe('print rules: other pages print untouched (was e2e report-print:132)', () => {
  it('every print selector is the chrome hook or inside the report: no html/body/global rule', () => {
    expect(printRules().length).toBeGreaterThan(0)
    const strays = printRules()
      .flatMap(selectorsOf)
      .filter((selector) => selector !== '[data-print-hide]' && !inReport(selector))
    expect(strays, 'a print rule reaches outside the report').toEqual([])
  })
})
