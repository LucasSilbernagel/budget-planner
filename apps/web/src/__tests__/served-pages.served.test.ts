// @vitest-environment node
/**
 * What the app's own server SENDS for a page: status, head metadata and the
 * first-paint body (story 84.4, FR137).
 *
 * Replaces `e2e/page-metadata.spec.ts` (head), `not-found.spec.ts`,
 * `docs-not-found.spec.ts` and the server-bytes half of
 * `loading-state.spec.ts` + `hydration.spec.ts` › "the pending markup".
 * Each claim is about the served document, so it needs the real server
 * (`src/test/served-app.ts`), not a browser.
 *
 * Named losses (story 84.4 D2): the HYDRATED `document.title` after the
 * client's `<HeadContent />` runs (the served head is pinned instead; that is
 * what a crawler reads), and the "Go home" click (its `href` is pinned here
 * and in `components/__tests__/NotFoundPage.test.tsx`).
 *
 * ⚠️ `toContain` on a whole document also matches the `<head>`: the landing
 * subtitle opens the meta description. Body claims read `bodyOf()`, and copy
 * claims match closing-tag markup.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FENCED_EMPTY_COPY, type GatedPath } from '../test/fenced-copy'
import {
  SERVED_APP_TIMEOUT_MS,
  SERVED_TEST_TIMEOUT_MS,
  type ServedApp,
  bodyOf,
  headOf,
  startServedApp,
} from '../test/served-app'

vi.setConfig({ testTimeout: SERVED_TEST_TIMEOUT_MS })

let app: ServedApp

beforeAll(async () => {
  app = await startServedApp()
}, SERVED_APP_TIMEOUT_MS)

afterAll(async () => {
  await app?.close()
})

const ROOT_DEFAULT_TITLE = 'Longhand Budget — track your finances with privacy and control'
const ROOT_DEFAULT_DESCRIPTION =
  'Track your finances with privacy and control — income, expenses, savings, and long-term plans. The free tier runs entirely in your browser, so your financial data never leaves your device.'

/** React escapes `'` and `&` in text and attributes; compare on decoded text. */
function decode(text: string): string {
  return text
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function titlesOf(html: string): string[] {
  return [...headOf(html).matchAll(/<title>([\s\S]*?)<\/title>/g)].map(([, t]) => decode(t ?? ''))
}

/** Every `<meta name="description">` in the head; exactly one is the claim. */
function descriptionsOf(html: string): string[] {
  return [...headOf(html).matchAll(/<meta name="description" content="([^"]*)"/g)].map(
    ([, content]) => decode(content ?? '')
  )
}

async function servedHead(path: string, status = 200) {
  const response = await app.get(path)
  expect(response.status, `${path} status`).toBe(status)
  const titles = titlesOf(response.body)
  expect(titles, `${path} must serve exactly one <title>`).toHaveLength(1)
  const descriptions = descriptionsOf(response.body)
  // ⚠️ Exactly one: reading the first would pass on a broken merge that served
  // the root default AND the route's description.
  expect(descriptions, `${path} must serve exactly one description`).toHaveLength(1)
  return { title: titles[0], description: descriptions[0], html: response.body }
}

describe('per-route metadata in the served head (was e2e page-metadata, story 40.1)', () => {
  it('a route that had no head before story 40.1 names itself', async () => {
    const { title, description } = await servedHead('/income')
    expect(title).toBe('Income · Longhand Budget')
    expect(description).toBe(
      'Manage your income streams and track your earnings across any pay frequency.'
    )
  })

  it('a route that already had a title keeps it and gains a description', async () => {
    const { title, description } = await servedHead('/pricing')
    expect(title).toBe('Pricing · Longhand Budget')
    expect(description).toBe('Free and Premium plans, and how billing works.')
  })

  it('two app pages do not share one title, and neither is the root default', async () => {
    const income = (await servedHead('/income')).title
    const expenses = (await servedHead('/expenses')).title
    expect(income).not.toBe(expenses)
    expect(income).not.toBe(ROOT_DEFAULT_TITLE)
    expect(expenses).not.toBe(ROOT_DEFAULT_TITLE)
  })

  it('a documentation page is named for the doc, not the section', async () => {
    const { title, description } = await servedHead('/docs/getting-started')
    expect(title).toBe('Getting Started · Longhand Budget')
    expect(description).toBe('Set up your income, expenses, and first overview.')
  })

  it('the root default applies to a route with no head of its own (the 404)', async () => {
    const { title, description } = await servedHead('/this-route-does-not-exist', 404)
    expect(title).toBe(ROOT_DEFAULT_TITLE)
    expect(description).toBe(ROOT_DEFAULT_DESCRIPTION)
  })

  it('an unknown doc slug names the section rather than a document', async () => {
    const { title, description } = await servedHead('/docs/this-doc-does-not-exist', 404)
    expect(title).toBe('Documentation · Longhand Budget')
    expect(description).toBeTruthy()
  })
})

describe('the global not-found page (was e2e not-found, story 6-4)', () => {
  it('serves a real HTTP 404, not a soft-200', async () => {
    expect((await app.get('/this-route-does-not-exist')).status).toBe(404)
  })

  it('serves the branded 404 inside the app chrome', async () => {
    const body = bodyOf((await app.get('/this-route-does-not-exist')).body)

    // The ONLY <h1> on the full shell is the subject heading.
    const h1s = body.match(/<h1[\s>][\s\S]*?<\/h1>/g) ?? []
    expect(h1s, 'exactly one <h1> on the served 404').toHaveLength(1)
    expect(h1s[0]).toMatch(/>\s*Page not found\s*<\/h1>$/)
    // The decorative eyebrow, as its own text node.
    expect(body).toMatch(/>404<\/p>/)
    expect(body).toContain('>Longhand Budget</p>')
    // The root layout's footer wraps it (not a bare fallback).
    expect(body).toMatch(/<footer[\s>]/)
    expect(body).toMatch(/<a [^>]*href="\/"[^>]*>Go home<\/a>/)
  })
})

describe('the docs not-found route (was e2e docs-not-found, story 39-1)', () => {
  const UNKNOWN_DOC = '/docs/this-doc-does-not-exist'

  it('an unknown slug serves a real HTTP 404', async () => {
    expect((await app.get(UNKNOWN_DOC)).status).toBe(404)
  })

  /**
   * ⚠️ Every assertion is on something ONLY the docs 404 renders: the global
   * fallback is also a 404 with the same `<h1>`, so neither distinguishes them.
   */
  it('serves the docs-specific card inside the docs chrome, not the global fallback', async () => {
    const body = decode(bodyOf((await app.get(UNKNOWN_DOC)).body))
    expect(body).toContain("couldn't find that documentation page")
    expect(body).toMatch(/<a href="\/docs"[^>]*>\s*Return to the documentation index/)
    expect(body).toMatch(/<h2[^>]*>\s*Documentation\s*<\/h2>/)
    expect(body).toContain('href="/docs/getting-started"')
  })
})

/**
 * Store-derived content is skeletoned in the server response (story 38.2).
 *
 * ⚠️ The `absent` strings are the point: a skeleton alone would pass on a page
 * that ALSO still served the zero underneath it. They come from ONE table,
 * `src/test/fenced-copy.ts`, shared with their positive controls (each phrase
 * IS the app's resolved copy) in `components/__tests__/loading-state.dom.test.tsx`,
 * so a phrase cannot be fenced here without being proven there.
 */
const GATED_ROUTES = [
  {
    path: '/',
    skeletons: [
      'overview-total-income-skeleton',
      'overview-total-expenses-skeleton',
      'overview-net-worth-skeleton',
      'overview-sections-skeleton',
    ],
  },
  {
    path: '/income',
    skeletons: ['period-total-amount-skeleton', 'income-list-skeleton'],
  },
  {
    path: '/expenses',
    skeletons: ['period-total-amount-skeleton', 'expenses-list-skeleton'],
  },
  {
    path: '/savings',
    skeletons: [
      'savings-total-skeleton',
      'savings-leftover-summary-skeleton',
      'savings-list-skeleton',
    ],
  },
  {
    path: '/balance',
    skeletons: [
      'stat-total-investments-skeleton',
      'stat-total-savings-skeleton',
      'stat-total-assets-skeleton',
      'stat-total-debts-skeleton',
      'stat-net-worth-skeleton',
      'balance-entries-skeleton',
    ],
  },
] as const satisfies readonly { path: GatedPath; skeletons: readonly string[] }[]

describe('loading state: the server response (was e2e loading-state, story 38.2)', () => {
  for (const { path, skeletons } of GATED_ROUTES) {
    it(`${path} serves skeletons, not a confident zero`, async () => {
      const response = await app.get(path)
      expect(response.status, `${path} did not return 200`).toBe(200)
      const html = decode(response.body)

      for (const testid of skeletons) {
        expect(html, `${path} is missing skeleton ${testid}`).toContain(`data-testid="${testid}"`)
      }
      for (const phrase of FENCED_EMPTY_COPY[path]) {
        expect(html, `${path} still serves "${phrase}"`).not.toContain(phrase)
      }
      expect(
        html.split('data-testid="page-loading-status"').length - 1,
        `${path} must carry exactly one loading status region`
      ).toBe(1)
    })
  }

  /** The SEO fence: static, store-independent content survives in the response. */
  it('static chrome survives on / (closing-tag markup, so the head cannot match)', async () => {
    const html = (await app.get('/')).body
    for (const markup of [
      '>Longhand Budget</h1>',
      '>Track your finances with privacy and control</p>',
      '>No account needed · Optional sync is EU-hosted · No bank connection.</p>',
      '>Premium Features</h2>',
      '>Multi-device sync</span>',
      '>Advanced Forecasting</span>',
    ]) {
      expect(html, `/ lost static content: ${markup}`).toContain(markup)
    }
  })
})

/**
 * The Overview's served HTML carries NO chart library (was e2e
 * refresh-to-figures AC-10, story 38.3, NFR9; moved by story 84.5).
 *
 * ⚠️ This exists because story 38.3's mutation M9 refuted that story's own
 * prediction: hoisting a lazy chart boundary out of the `!hydrated` mount gate
 * made the SERVER render chart markup while the client's first render showed
 * the Suspense fallback, and `e2e/hydration.spec.ts` stayed GREEN (React treats
 * a Suspense boundary that resolves differently on each side as ordinary
 * Suspense, not a mismatch). `overview-critical-path.guard.test.ts` cannot see
 * it either: it walks STATIC imports, and the chart import is dynamic. So the
 * served bytes are asserted directly: the chart library must not reach the
 * response at all, which is both the hydration fence and the critical-path one.
 */
describe('the Overview response keeps the chart library off the critical path', () => {
  it('/ serves no "recharts" anywhere in the document (was e2e refresh-to-figures:595)', async () => {
    const response = await app.get('/')
    expect(response.status).toBe(200)
    // Positive control: a real document came back, so a zero below is not the
    // silence of an empty body.
    expect(response.body.length, 'no SSR body was returned').toBeGreaterThan(1000)
    expect(response.body).toContain('data-testid="overview-net-worth"')

    const hits = response.body.match(/recharts/g)?.length ?? 0
    expect(
      hits,
      `the served / contains ${hits} "recharts" occurrence(s): a chart rendered on the server puts the chart library back on the critical path`
    ).toBe(0)
  })
})
