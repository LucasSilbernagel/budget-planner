import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLOBAL_CSS, cssRules } from '../test/css-rules'

/**
 * Helper text and row buttons pass WCAG AA (story 115.2, FR183; Lighthouse
 * audit 2026-10-07, A2).
 *
 * ⚠️ What this pins is SOURCE, not paint: jsdom applies no stylesheet. The
 * proof that the colours pass is the Lighthouse re-run recorded in the story.
 * The per-element token pins live beside each component's own tests; this file
 * holds the two rules that span many sites.
 */

const SRC = resolve(__dirname, '..')

function appTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'test' ? [] : appTsx(path)
    }
    return name.endsWith('.tsx') && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

describe('helper text and row buttons (story 115.2)', () => {
  it('`.text-faint` is gray-500 in light, the value `.text-muted` has', () => {
    // gray-400 measured 2.54:1 on white at all 15 of its sites; gray-500 is 4.83.
    const body = (selector: string) => {
      const rules = cssRules(GLOBAL_CSS).filter((rule) => rule.selector === selector)
      expect(rules, selector).toHaveLength(1)
      return (rules[0] as { body: string }).body.trim()
    }
    expect(body('.text-faint')).toBe('@apply text-gray-500 dark:text-gray-400;')
    expect(body('.text-faint')).toBe(body('.text-muted'))
  })

  it('no red-tint button keeps red-600 text (3.95:1 on red-100)', () => {
    // Line-level: every className here is one line today. The six Remove/Delete
    // buttons read red-700 (5.30:1) with a red-800 hover (5.74:1 on red-200).
    const hits = appTsx(SRC).flatMap((path) =>
      readFileSync(path, 'utf-8')
        .split('\n')
        .flatMap((line, i) =>
          /(^|[\s"'`])bg-red-100\b/.test(line) && /(^|[\s"'`])text-red-600\b/.test(line)
            ? [`${relative(SRC, path)}:${i + 1}`]
            : []
        )
    )
    expect(hits).toEqual([])
  })

  it('the six red-tint row buttons carry the AA pair at rest and on hover', () => {
    // An EXACT count, so a seventh written with the old colours, or one that lost
    // its hover, is visible.
    const pairs = appTsx(SRC).flatMap((path) =>
      readFileSync(path, 'utf-8')
        .split('\n')
        .filter(
          (line) =>
            /\bbg-red-100\b/.test(line) &&
            /\btext-red-700\b/.test(line) &&
            /\bhover:text-red-800\b/.test(line)
        )
    )
    expect(pairs).toHaveLength(6)
  })

  it('a red-800 hover never reaches dark mode', () => {
    // `.hover\:text-red-800:hover` (two classes' worth of specificity) outranks
    // `.dark\:text-red-300` (one) inside the dark media query, so without a
    // `dark:hover:` text colour a hovered button turns red-800 on dark red
    // (review 2026-10-07; measured in the compiled CSS).
    const bare = appTsx(SRC).flatMap((path) =>
      readFileSync(path, 'utf-8')
        .split('\n')
        .flatMap((line, i) =>
          /(^|[\s"'`])hover:text-red-800\b/.test(line) && !/\bdark:hover:text-red-300\b/.test(line)
            ? [`${relative(SRC, path)}:${i + 1}`]
            : []
        )
    )
    expect(bare).toEqual([])
  })
})
