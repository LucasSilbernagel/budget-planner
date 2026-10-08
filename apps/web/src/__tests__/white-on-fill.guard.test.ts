import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLOBAL_CSS, cssRules } from '../test/css-rules'

// White on green-600 is 3.30:1, below AA. Pins SOURCE only (jsdom applies no stylesheet),
// line by line: a className split over several lines would get past the `dark:` arm.

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
    // An EXACT count: an 8th green button with old tokens, or a site that lost the class, changes it.
    expect(hits(/(^|[\s"'`])fill-green\b/, /className=/).length).toBe(7)
  })
})
