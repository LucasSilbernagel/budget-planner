/**
 * `cancelActiveSubscriptionsForCustomer` (Story 5-3 review follow-up).
 *
 * This is the ONLY code that cancels a paying customer's Paddle subscription
 * (wired into account erasure) — the 2026-09-15 #3 review flagged it as
 * shipped with zero tests: its sole caller (`account.ts`) mocks the whole
 * module away, and `server/paddle/__tests__/` was otherwise empty.
 *
 * NFR8: no real network call — `fetch` is mocked directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPaddleConfig, captureError } = vi.hoisted(() => ({
  getPaddleConfig: vi.fn(),
  captureError: vi.fn(),
}))
vi.mock('@budget-planner/config', () => ({ getPaddleConfig }))
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/error-tracking', () => ({ captureError }))

import { cancelActiveSubscriptionsForCustomer } from '../subscription-api'

const API_BASE = 'https://sandbox-api.paddle.com'

function config(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: 'pdl_sdbx_key',
    apiBaseUrl: API_BASE,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const STATUS_QS = encodeURIComponent(['active', 'trialing', 'past_due', 'paused'].join(','))

beforeEach(() => {
  getPaddleConfig.mockReturnValue(config())
  vi.stubGlobal('fetch', vi.fn())
  captureError.mockClear()
})

describe('cancelActiveSubscriptionsForCustomer', () => {
  it('does nothing when no API key is configured', async () => {
    getPaddleConfig.mockReturnValue(config({ apiKey: undefined }))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    expect(fetch).not.toHaveBeenCalled()
  })

  it('lists then cancels every non-terminal subscription for the customer, effective immediately', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'sub_1' }, { id: 'sub_2' }] }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    expect(fetchMock).toHaveBeenCalledTimes(3)

    const [listUrl, listInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(listUrl).toBe(`${API_BASE}/subscriptions?customer_id=ctm_1&status=${STATUS_QS}`)
    expect(listInit.method).toBe('GET')
    expect((listInit.headers as Record<string, string>).Authorization).toBe('Bearer pdl_sdbx_key')

    const [cancel1Url, cancel1Init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(cancel1Url).toBe(`${API_BASE}/subscriptions/sub_1/cancel`)
    expect(cancel1Init.method).toBe('POST')
    expect(JSON.parse(cancel1Init.body as string)).toEqual({ effective_from: 'immediately' })

    const [cancel2Url] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(cancel2Url).toBe(`${API_BASE}/subscriptions/sub_2/cancel`)
  })

  it('URL-encodes the customer id and uses the configured apiBaseUrl (sandbox vs production)', async () => {
    getPaddleConfig.mockReturnValue(config({ apiBaseUrl: 'https://api.paddle.com' }))
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    await cancelActiveSubscriptionsForCustomer('ctm/with special chars')

    const [listUrl] = fetchMock.mock.calls[0] as [string]
    expect(listUrl).toBe(
      `https://api.paddle.com/subscriptions?customer_id=ctm%2Fwith%20special%20chars&status=${STATUS_QS}`
    )
  })

  it('does nothing further when the customer has no non-terminal subscriptions', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never throws when the list call returns a non-ok status', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))

    await expect(cancelActiveSubscriptionsForCustomer('ctm_1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never throws when the list call itself throws (network error / timeout)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    await expect(cancelActiveSubscriptionsForCustomer('ctm_1')).resolves.toBeUndefined()
  })

  it('never throws when a cancel call fails, and still attempts the remaining subscriptions', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'sub_1' }, { id: 'sub_2' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'already canceled' }, 409))
      .mockResolvedValueOnce(jsonResponse({}))

    await expect(cancelActiveSubscriptionsForCustomer('ctm_1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('never throws when a cancel call itself throws, and still attempts the remaining subscriptions', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'sub_1' }, { id: 'sub_2' }] }))
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValueOnce(jsonResponse({}))

    await expect(cancelActiveSubscriptionsForCustomer('ctm_1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('ignores malformed subscription entries (missing/non-string id)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: null }, {}, { id: 42 }, { id: 'sub_valid' }] })
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    // Only the one well-formed id should ever reach a cancel call.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [cancelUrl] = fetchMock.mock.calls[1] as [string]
    expect(cancelUrl).toBe(`${API_BASE}/subscriptions/sub_valid/cancel`)
  })

  it('passes a request timeout signal on both the list and cancel calls', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'sub_1' }] }))
      .mockResolvedValueOnce(jsonResponse({}))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    const [, listInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const [, cancelInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(listInit.signal).toBeInstanceOf(AbortSignal)
    expect(cancelInit.signal).toBeInstanceOf(AbortSignal)
  })

  it('includes paused subscriptions — Paddle Billing treats paused as non-terminal', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [] }))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    const [listUrl] = fetchMock.mock.calls[0] as [string]
    expect(listUrl).toContain(encodeURIComponent('paused'))
  })

  it('follows pagination across multiple pages instead of stopping at page one', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const nextPageUrl = `${API_BASE}/subscriptions?after=cursor_abc`
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'sub_page1' }],
          meta: { pagination: { has_more: true, next: nextPageUrl } },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ id: 'sub_page2' }], meta: { pagination: { has_more: false } } })
      )
      .mockResolvedValueOnce(jsonResponse({})) // cancel sub_page1
      .mockResolvedValueOnce(jsonResponse({})) // cancel sub_page2

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    expect(fetchMock).toHaveBeenCalledTimes(4)
    const [page2Url] = fetchMock.mock.calls[1] as [string]
    expect(page2Url).toBe(nextPageUrl)
    const cancelledUrls = [fetchMock.mock.calls[2]?.[0], fetchMock.mock.calls[3]?.[0]]
    expect(cancelledUrls).toEqual([
      `${API_BASE}/subscriptions/sub_page1/cancel`,
      `${API_BASE}/subscriptions/sub_page2/cancel`,
    ])
  })

  it('stops paginating when has_more is true but next is missing (never loops forever)', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'sub_1' }], meta: { pagination: { has_more: true } } })
    )
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a failed cancel to error tracking — the account row is already gone by then', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'sub_1' }] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'already canceled' }, 409))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ subscriptionId: 'sub_1', status: 409 })
    )
  })

  it('reports a cancel call that throws to error tracking', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'sub_1' }] }))
      .mockRejectedValueOnce(new Error('timed out'))

    await cancelActiveSubscriptionsForCustomer('ctm_1')

    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ subscriptionId: 'sub_1' })
    )
  })
})
