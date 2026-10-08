import { expect, test } from '@playwright/test'

// Runs only on chromium-prod: the service worker exists only in a real build.

test.describe('pwa (built server)', () => {
  test('a free-tier page + its localStorage state stay usable offline', async ({
    page,
    context,
  }) => {
    await page.goto('/income')
    await expect
      .poll(
        async () => {
          try {
            return await page.evaluate(() => navigator.serviceWorker.controller != null)
          } catch {
            return false
          }
        },
        { timeout: 20_000, intervals: [250, 500, 1000] }
      )
      .toBe(true)

    // Proves client state survives the offline reload: autoUpdate/clientsClaim must not
    // clobber persisted edits.
    await page.evaluate(() => {
      window.localStorage.setItem('pwa-offline-probe', 'persisted-offline')
    })

    // The first load bypassed the not-yet-active SW, so reload once online to let its
    // NetworkFirst route cache the document.
    await page.reload()
    await page.waitForTimeout(500)

    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Income Sources' })).toBeVisible()
    await expect(page.locator('footer')).toBeVisible()
    expect(await page.evaluate(() => window.localStorage.getItem('pwa-offline-probe'))).toBe(
      'persisted-offline'
    )
    await context.setOffline(false)
  })
})
