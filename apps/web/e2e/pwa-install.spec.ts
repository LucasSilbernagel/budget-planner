import { type Page, expect, test } from '@playwright/test'

/**
 * PWA install affordance E2E (story 17-1).
 *
 * The affordance is client-only: it renders NOTHING on the server / first paint
 * and only appears after the browser fires `beforeinstallprompt`. That event
 * cannot be triggered on demand by real Chromium in a test, so we synthesise it
 * — but only after hydration has attached the component's window listener, which
 * is why each check re-fires until the affordance appears. This verifies the
 * hydrated DOM, which SSR-only and unit checks cannot.
 */

declare global {
  interface Window {
    __installPromptCalled?: boolean
  }
}

const REGION = { name: /install solubudget/i }

/** Dispatch a fake `beforeinstallprompt` with spyable `prompt()` / `userChoice`. */
async function fireInstallPrompt(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') {
  await page.evaluate((choice) => {
    const event = new Event('beforeinstallprompt')
    Object.assign(event, {
      platforms: ['web'],
      userChoice: Promise.resolve({ outcome: choice, platform: 'web' }),
      prompt: () => {
        window.__installPromptCalled = true
        return Promise.resolve()
      },
    })
    window.dispatchEvent(event)
  }, outcome)
}

/** Re-fire the event until the (post-hydration) affordance is visible. */
async function showPrompt(page: Page) {
  const region = page.getByRole('region', REGION)
  await expect(async () => {
    await fireInstallPrompt(page)
    await expect(region).toBeVisible({ timeout: 500 })
  }).toPass()
  return region
}

test.describe('PWA install affordance (story 17-1)', () => {
  test('appears after beforeinstallprompt and triggers the native install flow', async ({
    page,
  }) => {
    await page.goto('/')
    const region = await showPrompt(page)

    await region.getByRole('button', { name: 'Install', exact: true }).click()

    await expect.poll(() => page.evaluate(() => window.__installPromptCalled === true)).toBe(true)
    await expect(region).toBeHidden()
  })

  test('dismissal is remembered across a reload', async ({ page }) => {
    await page.goto('/')
    const region = await showPrompt(page)

    await region.getByRole('button', { name: /dismiss install prompt/i }).click()
    await expect(region).toBeHidden()

    // Assert the persistence mechanism directly: the post-reload "hidden" check
    // alone could pass simply because the re-fired event was missed before the
    // listener re-attached, so verify the dismissal was actually written.
    const stored = await page.evaluate(() => localStorage.getItem('bp-pwa-install-dismissed'))
    expect(stored).not.toBeNull()

    // Reload + re-fire: the remembered dismissal keeps it hidden.
    await page.reload()
    await fireInstallPrompt(page)
    await expect(page.getByRole('region', REGION)).toBeHidden()
  })

  test('fits a 320px viewport without horizontal overflow and clears the bottom nav', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/')
    const region = await showPrompt(page)

    // No horizontal overflow at the smallest supported width (UX-DR9).
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflows).toBe(false)

    // The affordance stays within the viewport and above the fixed bottom nav.
    const box = await region.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(321)
    }

    // Vertical clearance: the banner's bottom edge must sit above the top of the
    // fixed bottom navigation, not merely fit horizontally.
    const navBox = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
    expect(navBox).not.toBeNull()
    if (box && navBox) {
      expect(box.y + box.height).toBeLessThanOrEqual(navBox.y)
    }
  })
})
