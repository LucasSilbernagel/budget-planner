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
  // --- Paddle: api.paddle.com, sandbox-api.paddle.com, cdn.paddle.com ---
  // Anchored to the host so only paddle.com (and its subdomains) match — a bare
  // /paddle\.com/ would also intercept unrelated hosts like notpaddle.com.evil.test.
  http.all(/^https?:\/\/([^/]+\.)?paddle\.com\//, () =>
    HttpResponse.json({
      mocked: true,
      data: {},
      meta: { request_id: 'msw-mock-request' },
    }),
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
    }),
  ),
]
