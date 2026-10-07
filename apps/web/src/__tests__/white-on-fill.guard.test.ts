import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLOBAL_CSS, cssRules } from '../test/css-rules'

/**
 * White text on a coloured fill passes WCAG AA in both themes (story 115.1,
 * FR183; Lighthouse audit 2026-10-07, A1).
 *
 * White on green-600 measures 3.30:1 and on green-500 2.28:1, below AA's 4.5:1
 * for normal text. Every white-text green fill therefore uses ONE shared class,
 * `.fill-green` (green-700, 5.02:1), in both themes. The red and blue fills keep
 * their 600 shade in dark too: white on red-500 is 3.76:1, on blue-500 3.68:1.
 *
 * ⚠️ What this pins is SOURCE, not paint: jsdom applies no stylesheet, so the
 * rendered colour is out of reach below the browser. The proof that the colours
 * pass is the Lighthouse re-run recorded in the story. This file stops the old
 * tokens from coming back.
 *
 * The scan is line-level: today every className is written on one line, so a
 * `dark:bg-red-500` and the `text-white` it fails against share a line. A
 * className split over several lines would get past the `dark:` arm.
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

const FILES = appTsx(SRC).map((path) => ({
  path: relative(SRC, path),
  lines: readFileSync(path, 'utf-8').split('\n'),
}))

function hits(pattern: RegExp, also?: RegExp): string[] {
  return FILES.flatMap(({ path, lines }) =>
    lines.flatMap((line, i) =>
      pattern.test(line) && (!also || also.test(line)) ? [`${path}:${i + 1}`] : []
    )
  )
}

describe('white text on a fill (story 115.1)', () => {
  it('`.fill-green` is green-700 with white text and no dark variant', () => {
    const rules = cssRules(GLOBAL_CSS).filter((rule) => rule.selector === '.fill-green')
    expect(rules).toHaveLength(1)
    const body = (rules[0] as { body: string }).body
    expect(body).toMatch(/\bbg-green-700\b/)
    expect(body).toMatch(/\btext-white\b/)
    // A dark variant would drop back to a lighter, failing green.
    expect(body).not.toMatch(/dark:/)
    expect(rules[0]?.atRules).toEqual(['@layer components'])
  })

  it('no app source uses the failing green fills', () => {
    expect(hits(/(^|[\s"'`:])bg-green-600\b/)).toEqual([])
    expect(hits(/(^|[\s"'`:])bg-green-500\b/)).toEqual([])
  })

  it('no white-text element drops its red, blue or green fill to 500 in dark', () => {
    expect(hits(/\bdark:(hover:)?bg-(red|blue|green)-500\b/, /\btext-white\b/)).toEqual([])
  })

  it('`.fill-green` is used on exactly the 7 white-text green sites', () => {
    // An EXACT count, not "at least one": an 8th green button written with the
    // old tokens, or a site that lost the class, both change it.
    // className lines only, so a comment naming the class is not a use.
    expect(hits(/(^|[\s"'`])fill-green\b/, /className=/).length).toBe(7)
  })
})
