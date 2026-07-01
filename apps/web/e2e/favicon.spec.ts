import { expect, test } from '@playwright/test'

/**
 * Favicon E2E (story 6-5). Verifies the refreshed favicon set is wired into the
 * document head and that every referenced asset actually resolves as an image —
 * i.e. no dead <link> references ship. The 512 maskable PNG is intentionally not
 * linked here; it belongs to the PWA manifest (story 7-1).
 */
test.describe('favicon', () => {
  test('document head links the refreshed favicon set', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute(
      'href',
      '/favicon.svg'
    )
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1)
    await expect(page.locator('link[rel="icon"][sizes="16x16"]')).toHaveAttribute(
      'href',
      '/favicon-16.png'
    )
    await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute(
      'href',
      '/favicon-32.png'
    )
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png'
    )
  })

  test('every linked icon asset resolves with an image content type', async ({ page }) => {
    await page.goto('/')

    const hrefs = (
      await page
        .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
    ).filter((href): href is string => href !== null)

    // ico + svg + 16 + 32 + apple-touch = 5 references, all must be live.
    expect(hrefs.length).toBeGreaterThanOrEqual(5)
    for (const href of hrefs) {
      const response = await page.request.get(href)
      expect(response.ok(), `${href} should return a 2xx`).toBeTruthy()
      expect(response.headers()['content-type'] ?? '', `${href} should be an image`).toMatch(
        /^image\//
      )
    }
  })
})
