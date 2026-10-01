import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type CssRule, GLOBAL_CSS, cssRules, selectorsOf } from '../test/css-rules'

/**
 * The theme follows the DEVICE, with nothing in between (was
 * `e2e/theme-dark-mode.spec.ts:30`, story 61.1, FR93; moved by story 84.5).
 *
 * The e2e original flipped the emulated `prefers-color-scheme` under an open
 * page and watched `<body>`'s painted canvas follow. Re-evaluating a media
 * query is the browser's job; OUR share is that the theme is wired to that
 * media query and to nothing else:
 *
 *   1. Tailwind's `dark:` utilities compile to the media query
 *      (`darkMode: 'media'`), not to a `.dark` class nobody sets;
 *   2. the hand-written page canvas (`styles/global.css`) darkens under
 *      `@media (prefers-color-scheme: dark)` too — `global.css` records that
 *      reverting it to `.dark body` left every `dark:`-utility check green, so
 *      `<body>` needs its own pin;
 *   3. no app source writes a `dark` class in any of the usual spellings
 *      (`classList`, `className`, `setAttribute('class', …)`), the shape the
 *      deleted 7-3 toggle used. A tripwire, not a proof: a class built at
 *      runtime from other strings would get past it.
 *
 * ⚠️ What is NOT pinned (the named D2 loss): the real re-evaluation of the media
 * query in a live page, and the painted colour. jsdom evaluates neither.
 */

const SRC = resolve(__dirname, '..')
// Read as text: the config is untyped ESM, and only its one key is the claim.
const TAILWIND_CONFIG = readFileSync(resolve(SRC, '..', 'tailwind.config.js'), 'utf-8')

function appSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'test' ? [] : appSources(path)
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('the theme follows prefers-color-scheme (was e2e theme-dark-mode:30)', () => {
  it("tailwind compiles `dark:` to the media query: darkMode is 'media'", () => {
    // Declarations only (a comment line mentioning `darkMode` is not one).
    // A trailing `// comment` is allowed (84.5 code review, MEASURED false RED).
    const declarations = [
      ...TAILWIND_CONFIG.matchAll(/^\s*darkMode\s*:\s*([^,\n/]+?)\s*,?\s*(?:\/\/.*)?$/gm),
    ].map((m) => (m[1] as string).trim())
    expect(declarations).toEqual(["'media'"])
  })

  it('darkens the page canvas under @media (prefers-color-scheme: dark), never under .dark', () => {
    const bodyRules = cssRules(GLOBAL_CSS).filter((rule) => selectorsOf(rule).includes('body'))
    const dark = bodyRules.filter((rule: CssRule) =>
      rule.atRules.some((at) => /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/.test(at))
    )
    expect(dark, 'no dark-scheme body rule in global.css').toHaveLength(1)
    expect((dark[0] as CssRule).body).toMatch(/\bbg-gray-900\b/)

    const classKeyed = cssRules(GLOBAL_CSS).filter((rule) =>
      // ANY `.dark` class in the selector, compound or inside `:is()`/`:where()`
      // (`html.dark body`, the 7-3 shape), but not `.dark-mode` (84.5 code review).
      selectorsOf(rule).some((selector) => /\.dark(?![\w-])/.test(selector))
    )
    expect(
      classKeyed.map((rule) => rule.selector),
      'a .dark selector never matches'
    ).toEqual([])
  })

  it('no app source writes a `dark` class in the usual spellings', () => {
    const files = appSources(SRC)
    // Positive control: the walk reached the app.
    expect(files.length).toBeGreaterThan(50)
    const DARK = /['"`]dark['"`]|['"`]dark\s|\sdark['"`]/
    const WRITES = [
      /classList\.(add|toggle|replace)\(([^)]*)\)/g,
      /className\s*=\s*(\{[^}]*\}|['"`][^'"`]*['"`])/g,
      /setAttribute\(\s*['"]class['"]\s*,([^)]*)\)/g,
    ]
    const writes = (source: string) =>
      WRITES.some((re) => [...source.matchAll(re)].some((m) => DARK.test(m[0])))
    // Positive control: each spelling is recognised (84.5 code review, MEASURED
    // misses before: `className = 'dark'`, `setAttribute('class', 'dark')`).
    for (const sample of [
      "document.documentElement.classList.add('dark')",
      "html.className = 'dark'",
      "<html className={isDark ? 'dark' : ''}>",
      "el.setAttribute('class', 'dark')",
    ]) {
      expect(writes(sample), sample).toBe(true)
    }
    const writers = files.filter((file) => writes(readFileSync(file, 'utf-8')))
    expect(writers).toEqual([])
  })
})
