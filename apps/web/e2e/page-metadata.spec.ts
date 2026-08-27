import { expect, test } from '@playwright/test'

/**
 * Per-route page metadata reaches the served document (story 40.1, FR65, AC-7).
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT TEST. `route-head-coverage.test.ts`
 * enumerates every route and asserts its `head()` returns a title and a
 * description — but that is a CONFIG OBJECT. It proves the value was written
 * down, never that TanStack renders it into the document a browser receives.
 * The two are genuinely separable: a route can hold a perfect `head()` while the
 * `<HeadContent />` that emits it is dropped from `__root.tsx`, and the unit
 * suite would stay green through it. Before this story the e2e suite asserted
 * ZERO titles, so nothing anywhere covered the rendering half.
 *
 * The description assertions read the DOM rather than the SSR string on purpose:
 * TanStack merges route meta over the root's, and the merge is what AC-4
 * depends on — a per-route description that loses the merge would still appear
 * in the source somewhere while the wrong one won.
 */

const ROOT_DEFAULT_TITLE = 'Longhand Budget — track your finances with privacy and control'
const ROOT_DEFAULT_DESCRIPTION =
  'Track your finances with privacy and control — income, expenses, savings, and long-term plans. The free tier runs entirely in your browser, so your financial data never leaves your device.'

async function descriptionOf(page: import('@playwright/test').Page): Promise<string | null> {
  const locator = page.locator('head meta[name="description"]')
  // ⚠️ Exactly one. `.first()` alone would read the route's description off a
  // document that ALSO carried the root default — i.e. a broken merge would
  // still satisfy every assertion below, on a defective page.
  await expect(locator).toHaveCount(1)
  return locator.getAttribute('content')
}

test.describe('per-route page metadata (story 40.1)', () => {
  test('a route that had NO head before this story now names itself', async ({ page }) => {
    await page.goto('/income')

    await expect(page).toHaveTitle('Income · Longhand Budget')
    const description = await descriptionOf(page)
    // Exact pin: it implies "not the root default" already, so no separate
    // not.toBe() is written — an assertion that cannot fail reads as a guard
    // while guarding nothing.
    expect(description).toBe(
      'Manage your income streams and track your earnings across any pay frequency.'
    )
  })

  test('a route that already had a title keeps it and gains a description', async ({ page }) => {
    await page.goto('/pricing')

    await expect(page).toHaveTitle('Pricing · Longhand Budget')
    const description = await descriptionOf(page)
    expect(description).toBe('Free and Premium plans, and how billing works.')
  })

  test('two app pages do not share one title', async ({ page }) => {
    await page.goto('/income')
    const income = await page.title()
    await page.goto('/expenses')
    const expenses = await page.title()

    expect(income).not.toBe(expenses)
    // Neither may have silently fallen back to the inherited default — which is
    // the exact failure mode that would ALSO make them "not equal" to nothing.
    expect(income).not.toBe(ROOT_DEFAULT_TITLE)
    expect(expenses).not.toBe(ROOT_DEFAULT_TITLE)
  })

  test('a documentation page is named for the doc, not the section', async ({ page }) => {
    await page.goto('/docs/getting-started')

    await expect(page).toHaveTitle('Getting Started · Longhand Budget')
    expect(await descriptionOf(page)).toBe('Set up your income, expenses, and first overview.')
  })

  test('the root default still applies to a route with no head of its own', async ({ page }) => {
    // A 404 inherits the root head — AC-3's "still applies to anything without
    // its own head". Asserted so that giving 19 routes their own titles cannot
    // quietly remove the fallback for everything else.
    await page.goto('/this-route-does-not-exist')

    await expect(page).toHaveTitle(ROOT_DEFAULT_TITLE)
    expect(await descriptionOf(page)).toBe(ROOT_DEFAULT_DESCRIPTION)
  })

  test('the SERVED HTML carries the per-route metadata, before any JavaScript runs', async ({
    request,
  }) => {
    // AC-7 says "the served HTML". Every other test here reads the HYDRATED DOM,
    // which a crawler never builds: if SSR head emission broke while client-side
    // <HeadContent/> still wrote the title, those tests stay green and a
    // non-JS crawler receives the root default. This asserts the raw bytes.
    const response = await request.get('/income')
    expect(response.status()).toBe(200)
    const html = await response.text()

    expect(html).toContain('<title>Income · Longhand Budget</title>')
    expect(html).toMatch(
      /<meta name="description" content="Manage your income streams and track your earnings across any pay frequency\."/
    )
    expect(html).not.toContain(`<title>${ROOT_DEFAULT_TITLE}</title>`)
  })

  test('an unknown doc slug names the section rather than a document', async ({ page }) => {
    // The `/docs/$docId` head has a second branch for the notFound/pending state.
    // The unit test calls that branch directly; this proves the branch is what a
    // browser actually receives on a real 404.
    await page.goto('/docs/this-doc-does-not-exist')

    await expect(page).toHaveTitle('Documentation · Longhand Budget')
    expect(await descriptionOf(page)).toBeTruthy()
  })

  test('robots.txt is served from the app origin', async ({ request }) => {
    // public/ serving under the SSR server is an assumption worth proving, not
    // asserting: a robots.txt that 404s is indistinguishable from no decision.
    const response = await request.get('/robots.txt')

    expect(response.status()).toBe(200)
    const body = await response.text()
    expect(body).toContain('User-agent: *')
    expect(body).toContain('Disallow: /api/')
    // AC-5 recorded that no sitemap ships yet; if one is added later this line
    // is the reminder to revisit the decision rather than silently diverge.
    // Anchored to the start of a line: the file EXPLAINS the omission in a
    // comment that necessarily contains the word, so a bare `toContain` here
    // fails against correct content. Case-insensitive and whitespace-tolerant
    // because robots.txt field names are case-insensitive and parsers accept
    // leading space — pinning one spelling of a directive that has equivalent
    // spellings is the exact hole `script-src-elem` opened in story 39.2.
    expect(body).not.toMatch(/^\s*sitemap\s*:/im)
  })
})
