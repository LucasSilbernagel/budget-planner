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

// Exact, not /install longhand/i: the short form is a strict PREFIX of the
// formal one, so a substring regex passes against "Install Longhand Budget"
// — i.e. against the very short_name drift this pin exists to catch.
const REGION = { name: 'Install Longhand', exact: true }

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
    //
    // ⚠️ Two-sided since story 31.5. `bottom-[calc(3.75rem_+_env(...))]` here is
    // one of THREE coupled call sites (`__root.tsx`'s reserve and the nav's own
    // inset are the others), and the one-directional form of this check fails
    // only when the offset is too SMALL. Left at the old 6rem against the
    // 56.75px bar, the banner floats 39.25px above it and this assertion passes
    // MORE comfortably than on a correct build — so the gap is bounded above too.
    const navBox = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
    expect(navBox).not.toBeNull()
    if (box && navBox) {
      const gap = navBox.y - (box.y + box.height)
      expect(
        gap,
        `the install banner overlaps the bottom nav (gap ${gap}px)`
      ).toBeGreaterThanOrEqual(0)
      expect(gap, `the install banner floats ${gap}px above the bottom nav`).toBeLessThanOrEqual(8)
    }
  })

  /**
   * ⚠️⚠️ THE TEST ABOVE RUNS AT THE DEFAULT ROOT FONT SIZE ONLY, AND THAT IS NOT
   * ENOUGH — a real regression slipped through it during code review.
   *
   * This banner's offset is the third leg of a three-way coupling with the
   * `__root.tsx` reserve and the nav's own inset. The bar's height is
   * `2.625rem + 14.75px`: its spacing scales with the root font but its
   * `text-[11px]` label line box does NOT, so a pure-rem offset is correct at
   * 16px and drifts everywhere else. `3.75rem` and `calc(2.625rem + 18px)` are
   * both exactly 60px at the 16px default — indistinguishable to the assertion
   * above — yet at a 12px root font the pure-rem form leaves the banner
   * overlapping the bar, and at 24px it floats it clear by 12px.
   *
   * Without this, the offset can silently revert to the pure-rem form (or to the
   * pre-31.5 `6rem`) while every other assertion stays green.
   */
  for (const root of [12, 24]) {
    test(`the install banner clears the bottom nav at a ${root}px root font size`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 640 })
      await page.addInitScript((px) => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = `${px}px`
        })
      }, root)
      await page.goto('/')
      await page.evaluate((px) => {
        document.documentElement.style.fontSize = `${px}px`
      }, root)
      const region = await showPrompt(page)

      const box = await region.boundingBox()
      const navBox = await page.getByRole('navigation', { name: 'Primary' }).boundingBox()
      expect(box).not.toBeNull()
      expect(navBox).not.toBeNull()
      if (box && navBox) {
        const gap = Math.round((navBox.y - (box.y + box.height)) * 100) / 100
        expect(
          gap,
          `the install banner overlaps the bottom nav at a ${root}px root font (gap ${gap}px)`
        ).toBeGreaterThanOrEqual(0)
        expect(
          gap,
          `the install banner floats ${gap}px above the bottom nav at a ${root}px root font`
        ).toBeLessThanOrEqual(8)
      }
    })
  }
})
