import { expect, test } from '@playwright/test'

/**
 * PWA E2E (story 7-1), modeled on e2e/favicon.spec.ts.
 *
 * Two groups, because the service worker only truly exists in a real BUILD:
 *
 *  - `pwa (manifest)` runs against the Vite dev server Playwright boots by
 *    default. vite-plugin-pwa serves the manifest in dev (devOptions.enabled),
 *    so installability metadata can be asserted there. It does NOT register a SW
 *    in dev: the dev SW is normally registered by an HMR <script> injected into
 *    index.html, and this app has no index.html (injectRegister: false), so dev
 *    registration is a no-op by design. That is fine — production registers
 *    `/sw.js` via `virtual:pwa-register`.
 *
 *  - `pwa (built server)` verifies the real service worker: registration,
 *    versioned precache, and the offline app shell. These require the production
 *    build's sw.js, so they are opt-in via PWA_OFFLINE_TEST=1 against a built
 *    server and skipped in the default (dev) run:
 *
 *      pnpm --filter @budget-planner/web build
 *      PORT=8080 pnpm --filter @budget-planner/web start &
 *      PLAYWRIGHT_BASE_URL=http://localhost:8080 PWA_OFFLINE_TEST=1 \
 *        pnpm --filter @budget-planner/web test:e2e pwa.spec.ts
 *
 * Live cross-device install/offline confirmation is deferred to Story 5-6's
 * launch-gate verification matrix.
 */

test.describe('pwa (manifest)', () => {
  test('links the web app manifest + theme-color from the document head', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest'
    )
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#16a34a')
  })

  test('serves a valid, installable manifest', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest')
    expect(response.ok()).toBeTruthy()
    // The dev server may report application/json; the built server reports
    // application/manifest+json (asserted by the node-adapter unit test).
    expect(response.headers()['content-type'] ?? '').toMatch(
      /application\/manifest\+json|application\/json/
    )

    const manifest = JSON.parse(await response.text())
    expect(manifest.name).toBeTruthy()
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')

    const sizes = (manifest.icons ?? []).map((icon: { sizes: string }) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
  })

  test('serves the any-purpose install icons as PNGs', async ({ page }) => {
    for (const href of ['/pwa-192.png', '/pwa-512.png']) {
      const response = await page.request.get(href)
      expect(response.ok(), `${href} should return a 2xx`).toBeTruthy()
      expect(response.headers()['content-type'] ?? '', `${href} should be a PNG`).toMatch(
        /^image\/png/
      )
    }
  })
})

test.describe('pwa (built server)', () => {
  // These require a real production build (dev has no registered SW / no
  // precache). Opt in with PWA_OFFLINE_TEST=1 against a built server.
  test.skip(
    process.env['PWA_OFFLINE_TEST'] !== '1',
    'Requires a production build + PWA_OFFLINE_TEST=1 (see file header).'
  )

  test('serves the service worker with a no-cache policy', async ({ page }) => {
    const response = await page.request.get('/sw.js')
    expect(response.ok()).toBeTruthy()
    expect(response.headers()['cache-control'] ?? '').toContain('no-cache')
  })

  test('registers a service worker on the client', async ({ page }) => {
    await page.goto('/')
    // A one-time autoUpdate reload (clientsClaim) can destroy the execution
    // context mid-evaluate; swallow that transient error and let poll retry.
    await expect
      .poll(
        async () => {
          try {
            return await page.evaluate(async () => {
              const registrations = await navigator.serviceWorker.getRegistrations()
              return registrations.some(
                (registration) =>
                  registration.active != null ||
                  registration.installing != null ||
                  registration.waiting != null
              )
            })
          } catch {
            return false
          }
        },
        { timeout: 20_000, intervals: [250, 500, 1000] }
      )
      .toBe(true)
  })

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
