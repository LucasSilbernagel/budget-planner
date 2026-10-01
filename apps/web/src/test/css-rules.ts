import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A brace-aware reader for `styles/global.css`, shared by the CSS-rule pins
 * (story 84.3's `pre-paint-suppression.dom.test.tsx`; story 84.5's print and
 * theme pins).
 *
 * ⚠️ These pins assert RULES, never a computed style: jsdom applies no
 * stylesheet and has no cascade, so what a rule paints is out of reach below the
 * browser (the named D2 loss each pin states).
 */

export interface CssRule {
  selector: string
  body: string
  /** The at-rule preludes enclosing the rule, outermost first (e.g. `@layer base`). */
  atRules: string[]
}

export const GLOBAL_CSS = readFileSync(resolve(__dirname, '..', 'styles', 'global.css'), 'utf-8')

/**
 * Every style rule in `css`, with the at-rules that enclose it.
 *
 * A brace-aware walk, not a flat regex (84.3 code review, MEASURED): a flat
 * `selector { body }` match cannot see an enclosing `@media`, so a rule moved
 * into `@media print` or `@media (min-width: 640px)` parsed identically and
 * every assertion stayed green while the 320px first frame flashed.
 * Comments are removed first.
 *
 * ⚠️ FAILS LOUDLY on input it cannot read rather than misreading it (84.5 code
 * review, MEASURED: an unterminated `{` looped forever, a `}` inside a string
 * silently truncated the body, a nested rule was swallowed into its parent):
 * an unterminated rule, an unbalanced `}`, a nested rule and a brace inside a
 * quoted string each throw. `global.css` has none of them today.
 */
export function cssRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  const stack: string[] = []
  let prelude = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') {
      const head = prelude.trim()
      prelude = ''
      if (head.startsWith('@')) {
        stack.push(head)
        continue
      }
      const close = text.indexOf('}', i)
      if (close === -1) throw new Error(`cssRules: unterminated rule "${head}"`)
      const body = text.slice(i + 1, close)
      if (body.includes('{'))
        throw new Error(`cssRules: nested rule inside "${head}" is not supported`)
      if ((body.match(/"/g) ?? []).length % 2 || (body.match(/'/g) ?? []).length % 2) {
        throw new Error(`cssRules: a brace inside a quoted string in "${head}" is not supported`)
      }
      rules.push({ selector: head, body, atRules: [...stack] })
      i = close
    } else if (ch === '}') {
      if (stack.length === 0) throw new Error('cssRules: unbalanced "}"')
      stack.pop()
      prelude = ''
    } else if (ch === ';' && prelude.trim().startsWith('@')) {
      prelude = '' // a statement at-rule such as `@tailwind base;`
    } else {
      prelude += ch
    }
  }
  if (stack.length > 0) throw new Error(`cssRules: unterminated at-rule "${stack.at(-1)}"`)
  return rules
}

/**
 * The selectors of a rule, split on TOP-LEVEL commas only and trimmed: the
 * comma inside `:is(a, b)` or `[title="a,b"]` does not split.
 */
export function selectorsOf(rule: CssRule): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (const ch of rule.selector) {
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '(' || ch === '[') {
      depth++
    } else if (ch === ')' || ch === ']') {
      depth--
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current.trim())
  return parts
}
