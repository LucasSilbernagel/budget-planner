import { expect, test } from '@playwright/test'

/**
 * `/docs/$docId` not-found wiring E2E (story 39-1, AC-3).
 *
 * This guards the ROUTE, not the component. `DocNotFound` moved out of the route
 * file in story 39-1 so the router could code-split it (BUG-C), and the thing a
 * careless move breaks is the `notFoundComponent:` wiring — silently, because an
 * unwired `notFoundComponent` still falls through to the router's own 404, which
 * is also a real 404 and also renders a byte-identical `<h1>Page not found</h1>`
 * (`src/components/NotFoundPage.tsx:47-49`).
 *
 * Nothing covered this before: `components/docs/__tests__/doc-not-found.test.tsx`
 * renders the component directly (it cannot see the route), `not-found.spec.ts`
 * exercises the GLOBAL unmatched-route fallback (a different mechanism), and
 * `theme-page-coverage.spec.ts` visits valid slugs only.
 *
 * ⚠️ Every assertion in the second test is on something ONLY the docs 404
 * renders. Neither the 404 status nor the `<h1>` distinguishes the two pages —
 * the global fallback has both — so an assertion on either would be green
 * against the very breakage this file exists to catch.
 *
 * POSITIVE CONTROL (measured, story 39-1 T6): delete `notFoundComponent` from
 * `routes/docs/$docId.tsx`. The SECOND test goes red; the FIRST stays GREEN,
 * because the loader's `notFound()` throw plus the router default still produce
 * a real 404. Only the second test is the wiring guard — the first pins the
 * status contract that the docs route shares with the global fallback.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

const UNKNOWN_DOC = '/docs/this-doc-does-not-exist'

test.describe('Docs not-found route (story 39-1)', () => {
  test('an unknown slug serves a real HTTP 404', async ({ page }) => {
    const response = await page.goto(UNKNOWN_DOC)
    expect(response?.status()).toBe(404)
  })

  test('renders the docs-specific not-found card, not the global fallback', async ({ page }) => {
    await page.goto(UNKNOWN_DOC)

    // Copy unique to DocNotFound. The global 404 says "Sorry, we couldn't find
    // the page you're looking for" — this phrasing appears nowhere else.
    await expect(page.getByText(/couldn't find that documentation page/i)).toBeVisible()

    // The recovery link goes back to the docs index, not the dashboard.
    const backLink = page.getByRole('link', { name: /return to the documentation index/i })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', '/docs')

    // It renders inside DocsLayout, so the docs sidebar is present. Asserted on
    // the sidebar's own heading AND one of its generated `DOC_PAGES` links: the
    // global fallback renders no `/docs/*` link at all, so this is what actually
    // proves the docs chrome survived. Anchored on the slug in the href rather
    // than the link's title, which is editable content.
    await expect(page.getByRole('heading', { level: 2, name: 'Documentation' })).toBeVisible()
    await expect(page.locator('a[href="/docs/getting-started"]')).toBeVisible()
  })
})
