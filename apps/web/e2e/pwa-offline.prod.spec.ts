import { expect, test } from '@playwright/test'

/**
 * The offline app shell, on the PRODUCTION build (story 7-1; flow F8 of the
 * FR137 critical-flow list). Moved here from `pwa.spec.ts` by story 84.4 (D4).
 *
 * ⚠️ `.prod.spec.ts` is load-bearing: only `chromium-prod` runs it, against
 * `pnpm build && node server-entry.mjs` (`playwright.config.ts`), because the
 * service worker only exists in a real build (dev registers none: the app has
 * no index.html and `injectRegister: false`). Before 84.4 this test sat in
 * `pwa.spec.ts` behind `PWA_OFFLINE_TEST=1`, which nothing set, so F8 ran in
 * NO gate and NO CI run.
 *
 * What moved below the browser instead: the manifest, its link and the
 * install icons (`src/__tests__/served-headers-and-assets.served.test.ts`) and
 * the production `/sw.js` no-cache policy (`server/__tests__/node-adapter.test.ts`).
 * Registration is covered here: the first wait needs an active, controlling SW.
 */

test.describe('pwa (built server)', () => {
  test('a free-tier page + its localStorage state stay usable offline', async ({
    page,
    context,
  }) => {
    // Use a real free-tier feature page (client-side / localStorage), not just the
    // landing shell, so this asserts the substantive half of AC-3: free-tier
    // functionality remains usable offline (Task 5).
    await page.goto('/income')
    // Wait for the SW to take control of the page.
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

    // Seed a free-tier value into the zustand-persist localStorage store so we can
    // prove client state survives the offline reload (autoUpdate/clientsClaim must
    // not clobber persisted edits — a story regression trap).
    await page.evaluate(() => {
      window.localStorage.setItem('pwa-offline-probe', 'persisted-offline')
    })

    // The first load is served by the network before the SW controls the page, so
    // the runtime app-shell cache is still empty. Reload once online through the
    // now-active SW so its NetworkFirst route caches the /income document (the same
    // "use it once online, then it works offline" behavior a real user gets). Wait
    // for the cache write to settle.
    await page.reload()
    await page.waitForTimeout(500)

    await context.setOffline(true)
    await page.reload()
    // The runtime-cached free-tier page must still render its real content offline
    // — not just the body/footer chrome — and localStorage must rehydrate.
    await expect(page.getByRole('heading', { level: 1, name: 'Income Sources' })).toBeVisible()
    await expect(page.locator('footer')).toBeVisible()
    expect(await page.evaluate(() => window.localStorage.getItem('pwa-offline-probe'))).toBe(
      'persisted-offline'
    )
    await context.setOffline(false)
  })
})
