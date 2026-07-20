/**
 * MSW request handlers.
 *
 * All external service calls MUST be intercepted in tests — no real network
 * requests are permitted (NFR8). These handlers cover every third-party service
 * the app talks to:
 *   - Formspark (contact-form submissions) — Ireland/EU (AWS-US subprocessor, ADR-004)
 *   - counter.dev (cookieless analytics script + beacons) — ADR-005
 *   - Brevo (transactional magic-link email) — EU/France
 *   - Paddle (billing / checkout / subscription APIs) — UK
 *
 * Handlers use RegExp matchers so both production and sandbox hosts are
 * covered without enumerating every path.
 */

import { http, HttpResponse } from 'msw'

export const handlers = [
  // --- Formspark (submit-form.com): contact-form submissions (Story 9-1) ---
  // The contact form POSTs client-side to https://submit-form.com/{FORM_ID}.
  // Intercepted so no real submission happens in CI and onUnhandledRequest:'error'
  // does not trip; per-test handlers override to assert the posted payload.
  // NOTE: Formspark stores in Ireland (EU) but its subprocessor AWS is US-owned —
  // the one documented, scoped NFR1/NFR2 exception (free-text feedback only, no
  // financial data). See ADR-004.
  http.post(/^https?:\/\/submit-form\.com\//, () =>
    HttpResponse.json({ success: true }, { status: 200 })
  ),

  // --- counter.dev: cookieless analytics script + beacons (Story 10-1) ---
  // The analytics tag loads https://cdn.counter.dev/script.js (a real SSR
  // <script data-id>) which then beacons GET /track + POST /trackpage. All are
  // intercepted so no real analytics call happens in CI and
  // onUnhandledRequest:'error' does not trip. counter.dev is cookieless and
  // sends only visitor metadata (referrer/screen/id/utcoffset/pathname), never
  // financial data — the recorded scoped exception. See ADR-005.
  http.all(/^https?:\/\/([^/]+\.)?counter\.dev\//, () => new HttpResponse(null, { status: 204 })),

  // --- Brevo (Sendinblue, EU/France): transactional email send (Story 5-16) ---
  // Magic-link emails go through Brevo's EU endpoint. Intercepted here so no
  // real send happens in CI (NFR8); per-test handlers override to assert payloads.
  http.post('https://api.brevo.com/v3/smtp/email', () =>
    HttpResponse.json({ messageId: 'msw-mock-message-id' }, { status: 201 })
  ),

  // --- Paddle: api.paddle.com, sandbox-api.paddle.com, cdn.paddle.com ---
  // Anchored to the host so only paddle.com (and its subdomains) match — a bare
  // /paddle\.com/ would also intercept unrelated hosts like notpaddle.com.evil.test.
  http.all(/^https?:\/\/([^/]+\.)?paddle\.com\//, () =>
    HttpResponse.json({
      mocked: true,
      data: {},
      meta: { request_id: 'msw-mock-request' },
    })
  ),
]
