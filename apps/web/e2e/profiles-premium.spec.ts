import { expect, test } from '@playwright/test'

/**
 * Custom Profiles premium gating E2E (story 13-3).
 *
 * `/profiles` is a Premium feature. Against the real route tree with no active
 * session, the route must resolve (client-side, via `usePremiumAccess`) to the
 * discoverable LOCKED upgrade surface — not the create/switch management UI.
 *
 * The preview runtime cannot mint an active session (no test session + the
 * premium-check Buffer gap makes `checkPremiumAccessServer` fail closed), so the
 * UNLOCKED (active) path — the working `/profiles` management UI — is covered by
 * the mocked unit tests (`routes/__tests__/profiles.test.tsx`). Here we assert
 * the locked path e2e, which is exactly what a free/anonymous visitor sees.
 *
 * Requires browser binaries:
 *   pnpm --filter @budget-planner/web exec playwright install chromium
 */

test('/profiles resolves to the locked upgrade surface for a non-premium visitor', async ({
  page,
}) => {
  await page.goto('/profiles')
  await page.waitForLoadState('networkidle')

  // Locked upgrade surface (the shared PremiumPrompt), naming the feature.
  await expect(page.getByRole('heading', { name: /go premium/i })).toBeVisible()
  await expect(page.getByText(/custom profiles/i).first()).toBeVisible()

  // The management UI is NOT reachable without an active subscription.
  await expect(page.getByRole('button', { name: /new profile/i })).toHaveCount(0)

  // The locked surface offers an upgrade CTA (mirrors the /forecasting locked page).
  await expect(page.getByRole('link', { name: /upgrade to premium/i })).toBeVisible()
})
