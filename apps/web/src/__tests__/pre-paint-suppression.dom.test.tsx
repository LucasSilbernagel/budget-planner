import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GlobalNav } from '../components/layout/GlobalNav'
import { AccountNoticeBox } from '../components/overview/AccountNoticeBox'
import { NO_FLASH_PLANNER_SCRIPT } from '../lib/nav/no-flash-planner-visibility-script'
import { ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY } from '../lib/overview/account-notice-dismissal'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../lib/overview/no-flash-account-notice-script'
import {
  PLANNER_VISIBILITY_STORAGE_KEY,
  usePlannerVisibilityStore,
} from '../stores/plannerVisibilityStore'

/**
 * The pre-paint suppression chain, below the browser (story 84.3, D2; FR137).
 *
 * Two features hide a node on the FIRST frame, before React runs: the
 * Retirement nav entry for a user who turned the planner off (story 35.2) and
 * the dismissed Overview account notice (story 55.1). Each is a chain:
 *
 *   1. a synchronous `<head>` script marks `<html>` from localStorage
 *      (behaviour pinned by `lib/**\/no-flash-*-script.dom.test.ts`);
 *   2. `__root.tsx` emits that script INSIDE `<head>`, so it runs before the
 *      body is parsed (pinned below, on the source);
 *   3. a `global.css` rule hides the node the SERVER rendered, matched by the
 *      attribute the script sets and a hook the component renders (pinned
 *      below: the rule exists, says `display: none`, and its selector matches
 *      exactly the server-rendered nodes once the real script has run).
 *
 * ⚠️ What is NOT pinned (the named D2 loss, Lucas 2026-10-01): that the rule
 * WINS the cascade at every width and that the first painted frame shows no
 * flash. jsdom has no cascade and no paint. That was measured by
 * `e2e/nav-planner-visibility.spec.ts` and `e2e/overview-account-notice.spec.ts`
 * until story 84.3 retired them.
 */

const WEB = resolve(__dirname, '..', '..')
const GLOBAL_CSS = readFileSync(resolve(WEB, 'src/styles/global.css'), 'utf-8')
const ROOT_SOURCE = readFileSync(resolve(WEB, 'src/routes/__root.tsx'), 'utf-8')

interface CssRule {
  selector: string
  body: string
  /** The at-rule preludes enclosing the rule, outermost first (e.g. `@layer base`). */
  atRules: string[]
}

/**
 * Every style rule in `global.css`, with the at-rules that enclose it.
 *
 * A brace-aware walk, not a flat regex (84.3 code review, MEASURED): a flat
 * `selector { body }` match cannot see an enclosing `@media`, so a rule moved
 * into `@media print` or `@media (min-width: 640px)` parsed identically and
 * every assertion below stayed green while the 320px first frame flashed.
 * Comments are removed first; strings in this file hold no braces.
 */
function cssRules(css: string): CssRule[] {
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
      rules.push({ selector: head, body: text.slice(i + 1, close), atRules: [...stack] })
      i = close
    } else if (ch === '}') {
      stack.pop()
      prelude = ''
    } else if (ch === ';' && prelude.trim().startsWith('@')) {
      prelude = '' // a statement at-rule such as `@tailwind base;`
    } else {
      prelude += ch
    }
  }
  return rules
}

/** The ONE rule whose selector starts with `prefix`. */
function ruleStartingWith(prefix: string): CssRule {
  const hits = cssRules(GLOBAL_CSS).filter((rule) => rule.selector.startsWith(prefix))
  expect(hits, `expected exactly one global.css rule starting ${prefix}`).toHaveLength(1)
  return hits[0] as CssRule
}

/**
 * Applies at every width, theme and medium: only `@layer` may enclose it.
 * `@media`, `@supports` and `@container` would each scope the hide to some
 * first frames and not others.
 */
const appliesUnconditionally = (rule: CssRule) =>
  rule.atRules.every((prelude) => /^@layer\b/.test(prelude))

/** The LAST `display` declaration wins in CSS, so that is the one read. */
function lastDisplay(body: string): string | undefined {
  const values = [...body.matchAll(/(?:^|;)\s*display\s*:\s*([^;!]+)(!important)?/g)].map((m) =>
    (m[1] as string).trim()
  )
  return values.at(-1)
}

/** Server-render `ui` (no effects run) into the live document, as the first frame. */
async function firstFrame(ui: () => React.ReactElement) {
  const rootRoute = createRootRoute({ component: ui })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  const container = document.createElement('div')
  container.innerHTML = renderToString(<RouterProvider router={router} />)
  document.body.appendChild(container)
  return container
}

/** Run a `<head>` bootstrap exactly as the browser would: as script text. */
const runBootstrap = (script: string) => new Function(script)()

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-hide-retirement')
  document.documentElement.removeAttribute('data-dismiss-account-notice')
  // The server and first client render paint the deterministic default.
  usePlannerVisibilityStore.setState({ showRetirementPlanner: true })
})
afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-hide-retirement')
  document.documentElement.removeAttribute('data-dismiss-account-notice')
  localStorage.clear()
})

describe('pre-paint suppression — the <head> wiring (__root.tsx)', () => {
  it('emits both bootstraps as inline scripts INSIDE <head>, before <HeadContent />, never deferred', () => {
    // The JSX elements on their own lines, not a `<head>` mention in a comment.
    const open = ROOT_SOURCE.search(/\n\s*<head>\n/)
    const close = ROOT_SOURCE.search(/\n\s*<\/head>\n/)
    expect(open, 'no <head> element in __root.tsx').toBeGreaterThan(-1)
    expect(close, 'no </head> after <head>').toBeGreaterThan(open)
    const head = ROOT_SOURCE.slice(open, close)
    const headContentAt = head.indexOf('<HeadContent />')
    expect(headContentAt, 'no <HeadContent /> inside <head>').toBeGreaterThan(-1)
    for (const name of ['NO_FLASH_PLANNER_SCRIPT', 'NO_FLASH_ACCOUNT_NOTICE_SCRIPT']) {
      const tag = head.match(
        new RegExp(`<script[^>]*dangerouslySetInnerHTML=\\{\\{ __html: ${name} \\}\\}[^>]*/>`)
      )
      expect(tag, `${name} is not an inline <script> inside <head>`).not.toBeNull()
      expect(tag?.[0], `${name} is deferred`).not.toMatch(/\b(async|defer|src|type)\b/)
      // Before `<HeadContent />` (D2 of 84.3): ahead of the route's stylesheets
      // and meta, so nothing in <head> can paint before the mark is set.
      expect(head.indexOf(tag?.[0] as string), `${name} comes after <HeadContent />`).toBeLessThan(
        headContentAt
      )
      // Exactly once in the whole file: never also after <head>.
      expect(
        ROOT_SOURCE.split(`__html: ${name}`).length - 1,
        `${name} is emitted more than once`
      ).toBe(1)
    }
  })
})

describe('pre-paint suppression — the Retirement nav entry (story 35.2)', () => {
  const rule = () => ruleStartingWith("[data-hide-retirement='1']")

  it('global.css hides it with display: none, unscoped by any @media/@supports', () => {
    expect(lastDisplay(rule().body), rule().body).toBe('none')
    expect(
      appliesUnconditionally(rule()),
      `the rule is scoped by: ${rule().atRules.join(' > ')}`
    ).toBe(true)
  })

  it('once the real bootstrap marks <html>, the rule matches every server-rendered Retirement entry and no other nav node', async () => {
    localStorage.setItem(
      PLANNER_VISIBILITY_STORAGE_KEY,
      JSON.stringify({ state: { showRetirementPlanner: false }, version: 0 })
    )
    runBootstrap(NO_FLASH_PLANNER_SCRIPT)
    const container = await firstFrame(() => <GlobalNav />)

    // The server rendered the default (both copies present)…
    const entries = container.querySelectorAll('li[data-nav-path="/retirement"]')
    expect(entries, 'the server HTML lost a Retirement copy').toHaveLength(2)
    // …and the rule's selector reaches exactly those.
    const matched = [...document.querySelectorAll(rule().selector)]
    expect(matched).toHaveLength(2)
    for (const el of matched) expect(el.getAttribute('data-nav-path')).toBe('/retirement')
  })

  // ⚠️ Two cases, because the bootstrap has two "not hidden" paths: nothing
  // persisted (it returns before reading the flag) and a persisted `true`.
  // The `setState` in `beforeEach` WRITES the key (persist's write path runs
  // even under `skipHydration`), so the first case must remove it again.
  it.each([
    ['nothing was ever persisted', () => localStorage.removeItem(PLANNER_VISIBILITY_STORAGE_KEY)],
    [
      'the planner is persisted as visible',
      () =>
        localStorage.setItem(
          PLANNER_VISIBILITY_STORAGE_KEY,
          JSON.stringify({ state: { showRetirementPlanner: true }, version: 0 })
        ),
    ],
  ])('matches nothing when %s (positive control)', async (_case, seed) => {
    seed()
    runBootstrap(NO_FLASH_PLANNER_SCRIPT)
    const container = await firstFrame(() => <GlobalNav />)
    expect(container.querySelectorAll('li[data-nav-path="/retirement"]')).toHaveLength(2)
    expect(document.querySelectorAll(rule().selector)).toHaveLength(0)
  })
})

describe('pre-paint suppression — the dismissed account notice (story 55.1)', () => {
  const rule = () => ruleStartingWith("[data-dismiss-account-notice='1']")

  it('global.css hides it with display: none, unscoped by any @media/@supports', () => {
    expect(lastDisplay(rule().body), rule().body).toBe('none')
    expect(
      appliesUnconditionally(rule()),
      `the rule is scoped by: ${rule().atRules.join(' > ')}`
    ).toBe(true)
  })

  it('once the real bootstrap marks <html>, the rule matches the server-rendered box', async () => {
    localStorage.setItem(ACCOUNT_NOTICE_DISMISSED_STORAGE_KEY, '1')
    runBootstrap(NO_FLASH_ACCOUNT_NOTICE_SCRIPT)
    const container = await firstFrame(() => <AccountNoticeBox />)

    const box = container.querySelector('[data-account-notice]')
    expect(box, 'the server HTML lost the box (the SEO fence forbids that)').not.toBeNull()
    expect([...document.querySelectorAll(rule().selector)]).toEqual([box])
  })

  it('matches nothing when the notice was never dismissed (positive control)', async () => {
    runBootstrap(NO_FLASH_ACCOUNT_NOTICE_SCRIPT)
    const container = await firstFrame(() => <AccountNoticeBox />)
    expect(container.querySelector('[data-account-notice]')).not.toBeNull()
    expect(document.querySelectorAll(rule().selector)).toHaveLength(0)
  })
})
