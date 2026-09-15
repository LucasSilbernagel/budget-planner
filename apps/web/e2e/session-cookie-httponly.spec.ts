import { expect, test } from '@playwright/test'

/**
 * Real-browser proof of the Story 53.1 root cause (AC-1).
 *
 * Every other test covering this story's root cause runs against jsdom
 * (`SyncProvider.test.tsx`, `SyncProvider.session-cookie-visibility.test.ts`),
 * which cannot enforce `HttpOnly` the way a real browser does — that gap is
 * exactly what let the original defect ship undetected (jsdom's
 * `document.cookie` is a plain read/write property with no HttpOnly
 * awareness). This spec proves the one fact those tests cannot: in a REAL
 * Chromium browser, an `HttpOnly` cookie is genuinely invisible to
 * `document.cookie`, and a non-`HttpOnly` one is genuinely visible — the two
 * cookies this story's fix relies on being treated differently.
 *
 * No live Postgres/Brevo account is available in this environment to drive an
 * actual magic-link login end to end, so this spec sets cookies via
 * Playwright's `context.addCookies()` with the SAME shape production code
 * uses (`session`: HttpOnly; `has_session`: not) rather than mocking anything
 * at the browser level — cookie visibility enforcement itself is 100% real,
 * unmocked Chromium behavior either way; only how the cookies got INTO the
 * jar differs from a live login.
 */

test.describe('session cookie visibility in a real browser (Story 53.1, AC-1)', () => {
  test('an HttpOnly cookie is invisible to document.cookie; a non-HttpOnly one is visible', async ({
    page,
    context,
  }) => {
    await page.goto('/')
    const url = page.url()

    await context.addCookies([
      { name: 'session', value: 'real-session-token', url, httpOnly: true, sameSite: 'Lax' },
      { name: 'has_session', value: '1', url, httpOnly: false, sameSite: 'Lax' },
    ])

    // Reload so the cookies are attached the way a real post-login navigation
    // would carry them (addCookies alone doesn't require a reload for
    // document.cookie visibility, but this matches the real flow).
    await page.reload()

    const documentCookie = await page.evaluate(() => document.cookie)

    // The exact claim the pre-53.1 code got backwards: checking `document.
    // cookie` for `session=` can never see it. Anchored against the
    // `has_session=` substring collision, same as the unit-level repro.
    expect(/(?:^|;\s*)session=/.test(documentCookie)).toBe(false)
    expect(documentCookie).toContain('has_session=1')

    // Independent confirmation via Playwright's own cookie jar (not just
    // document.cookie), so this doesn't rely on a single read path.
    const cookies = await context.cookies()
    const sessionCookie = cookies.find((c) => c.name === 'session')
    const hasSessionCookie = cookies.find((c) => c.name === 'has_session')
    expect(sessionCookie?.httpOnly).toBe(true)
    expect(hasSessionCookie?.httpOnly).toBe(false)
  })
})
