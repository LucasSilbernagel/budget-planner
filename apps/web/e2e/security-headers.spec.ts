import { expect, test } from '@playwright/test'

/**
 * Security response headers E2E (story sec-1).
 *
 * Drives the REAL hydration path under the enforced Content-Security-Policy —
 * the surface that unit tests (pure header function) and SSR-HTML smoke cannot
 * reach. A CSP that is syntactically present but blocks the framework's inline
 * hydration scripts, the no-flash theme bootstrap, or Recharts is a FAILURE
 * (AC-2); the honest signal is the browser reporting zero
 * `securitypolicyviolation` events while every surface still works.
 *
 * Note: run against the dev server (plain HTTP), so HSTS is intentionally absent
 * here (it is gated on `x-forwarded-proto: https`); the HSTS gate is covered by
 * the unit tests.
 */

const THEME_KEY = 'budget-planner-theme-prefs-v1'

/** Registered before any page script so it catches violations from first paint. */
function installViolationCollector() {
  return () => {
    ;(window as unknown as { __csp: string[] }).__csp = []
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} <= ${e.blockedURI || 'inline'}`
      )
    })
  }
}

function readViolations(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
}

/** Pull the `'nonce-…'` value out of a CSP header string. */
function nonceFromCsp(csp: string): string | undefined {
  return csp.match(/'nonce-([^']+)'/)?.[1]
}

test('AC-1: the document response carries a strict Content-Security-Policy + the hardening headers', async ({
  page,
}) => {
  const response = await page.goto('/')
  expect(response?.ok()).toBeTruthy()

  const headers = response?.headers() ?? {}
  const csp = headers['content-security-policy']
  expect(csp, 'CSP header present on the document response').toBeTruthy()

  // Strict script policy: a per-request nonce + the theme hash, no unsafe-inline.
  expect(csp).toMatch(/script-src [^;]*'nonce-[^']+'/)
  expect(csp).toMatch(/script-src [^;]*'sha256-[^']+'/)
  expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/)
  // Baseline lockdown.
  expect(csp).toContain(`frame-ancestors 'none'`)
  expect(csp).toContain(`object-src 'none'`)
  expect(csp).toContain(`base-uri 'self'`)
  expect(csp).toContain(`default-src 'self'`)

  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  expect(headers['permissions-policy']).toContain('payment=()')
  // Legacy headers preserved.
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['x-frame-options']).toBe('DENY')
  // HSTS is gated on confirmed HTTPS — absent over the dev server's plain HTTP.
  expect(headers['strict-transport-security']).toBeUndefined()
})

test('AC-1: the CSP nonce is per-request and matches the nonce rendered into the document', async ({
  page,
}) => {
  const r1 = await page.goto('/')
  const csp1 = r1?.headers()['content-security-policy'] ?? ''
  const headerNonce = nonceFromCsp(csp1)
  expect(headerNonce, 'header carries a nonce').toBeTruthy()

  // The framework emits the same nonce as a <meta> the client reads back.
  const metaNonce = await page.getAttribute('meta[property="csp-nonce"]', 'content')
  expect(metaNonce).toBe(headerNonce)

  // A second request gets a fresh nonce (per-request, not a constant)...
  const r2 = await page.goto('/')
  const headerNonce2 = nonceFromCsp(r2?.headers()['content-security-policy'] ?? '')
  expect(headerNonce2).toBeTruthy()
  expect(headerNonce2).not.toBe(headerNonce)

  // ...AND the rendered document must carry THAT request's nonce, not a stale
  // one. Re-reading the <meta> here (not just the header) catches a getRouter()
  // memoization regression that would freeze the rendered nonce while the header
  // keeps rotating — which silently blocks every inline script post-regression.
  const metaNonce2 = await page.getAttribute('meta[property="csp-nonce"]', 'content')
  expect(metaNonce2).toBe(headerNonce2)
})

test('AC-2: the no-flash theme bootstrap executes under the CSP (hash-authorized inline script)', async ({
  page,
}) => {
  await page.addInitScript(installViolationCollector())
  await page.addInitScript(
    ([key]) => {
      window.localStorage.setItem(key, JSON.stringify({ state: { theme: 'dark' }, version: 0 }))
      document.addEventListener('DOMContentLoaded', () => {
        ;(window as unknown as { __htmlAtDCL?: string }).__htmlAtDCL =
          document.documentElement.className
      })
    },
    [THEME_KEY]
  )

  await page.goto('/')

  // If the strict script-src had blocked the inline bootstrap, `.dark` would
  // never be applied at first paint.
  const classAtFirstPaint = await page.evaluate(
    () => (window as unknown as { __htmlAtDCL?: string }).__htmlAtDCL ?? ''
  )
  expect(classAtFirstPaint).toContain('dark')
  expect(await readViolations(page)).toEqual([])
})

test('AC-2: Recharts renders and client-side hydration works with ZERO CSP violations', async ({
  page,
}) => {
  await page.addInitScript(installViolationCollector())
  // Seed finances so the home overview renders a real Recharts chart (not the
  // empty state) — mirrors responsive-320.spec.ts.
  await page.addInitScript(() => {
    const now = new Date().toISOString()
    const row = (name: string, amount: number) => ({
      id: crypto.randomUUID(),
      userId: 0,
      name,
      amount,
      frequency: 'monthly',
      createdAt: now,
      updatedAt: now,
    })
    localStorage.setItem(
      'budget-planner-income-v1',
      JSON.stringify({
        state: { incomeSources: [row('Salary', 800000), row('Dividends', 120000)] },
        version: 1,
      })
    )
    localStorage.setItem(
      'budget-planner-expenses-v1',
      JSON.stringify({
        state: { expenses: [row('Rent', 300000), row('Groceries', 65000)] },
        version: 1,
      })
    )
  })

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Recharts mounted and drew (attribute styles need `style-src 'unsafe-inline'`,
  // which is present; a blocked style would surface as a violation below).
  await expect(page.locator('.recharts-responsive-container').first()).toBeVisible()

  // Hydration alive: a client-side route change must not spawn any CSP violation
  // (the framework injects nonce'd scripts for the navigated route).
  await page.getByRole('link', { name: 'Income' }).first().click()
  await expect(page).toHaveURL(/\/income$/)
  await page.waitForLoadState('networkidle')

  expect(await readViolations(page)).toEqual([])
})
