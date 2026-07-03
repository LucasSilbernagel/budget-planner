/**
 * MSW request handlers.
 *
 * All external service calls MUST be intercepted in tests — no real network
 * requests are permitted (NFR8). These handlers cover the two third-party
 * services the app talks to:
 *   - Paddle  (billing / checkout / subscription APIs) — UK
 *   - EthicalAds (ad decision endpoint) — Germany/EU
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

  // --- EthicalAds: decision endpoint + widget script + view/click pixels ---
  // Match any ethicalads.io host (media./server./g.ethicalads.io) so a real
  // widget load does not slip past and trip onUnhandledRequest:'error'.
  http.all(/^https?:\/\/([^/]+\.)?ethicalads\.io\//, () =>
    HttpResponse.json({
      id: 'msw-mock-ad',
      text: 'Mocked ad — no real ad request was made.',
      body: 'Mocked ad — no real ad request was made.',
      image: null,
      link: 'https://example.test/mock-ad',
      view_url: 'https://example.test/mock-view',
      nonce: 'msw-mock-nonce',
    })
  ),
]
