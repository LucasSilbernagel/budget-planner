/**
 * The forecasting page's transport (story 83.1, FR136).
 *
 * The page's arms depend on three properties pinned here: every call is the
 * route's `ApiResult` for ANY status (a refusal's `error` is shown verbatim), a
 * body that is not an `ApiResult` becomes a fallback failure instead of a throw,
 * and a NETWORK failure still rejects (the page's catch arms). That the URLs and
 * bodies match the real routes is proven by `forecasting-transport-chain.db.test.tsx`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteForecast,
  fetchForecasts,
  fetchProfiles,
  saveForecast,
  updateForecast,
} from '../forecast-api'

const fetchMock = vi.fn()

function answer(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requests', () => {
  it('each function calls its route with its method', async () => {
    fetchMock.mockImplementation(async () => answer({ success: true, data: [] }))

    await fetchProfiles()
    await fetchForecasts()
    await fetchForecasts('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    await saveForecast({ name: 'Plan', scenarioData: { a: 1 }, profileId: 'p' })
    await updateForecast('7', { name: 'Plan', scenarioData: { a: 1 } })
    await deleteForecast('42')

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/profiles', 'GET'],
      ['/api/forecasts', 'GET'],
      ['/api/forecasts?profileId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'GET'],
      ['/api/forecasts', 'POST'],
      ['/api/forecasts?id=7', 'PUT'],
      ['/api/forecasts?id=42', 'DELETE'],
    ])
  })

  it('a save sends the input as a JSON body', async () => {
    fetchMock.mockResolvedValue(answer({ success: true, data: { id: 1 } }))
    const input = { name: 'Plan', scenarioData: { scenario: {} }, profileId: 'p' }

    await saveForecast(input)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual(input)
  })

  it('an update sends the input as a JSON body (story 97.1)', async () => {
    fetchMock.mockResolvedValue(answer({ success: true, data: { id: 7 } }))
    const input = { name: 'Plan', description: 'd', scenarioData: { scenario: {} } }

    await updateForecast('7', input)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual(input)
  })

  it('query values are encoded', async () => {
    fetchMock.mockResolvedValue(answer({ success: true }))
    await deleteForecast('1&id=2')
    await updateForecast('1&id=2', { name: 'x', scenarioData: {} })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/forecasts?id=1%26id%3D2',
      '/api/forecasts?id=1%26id%3D2',
    ])
  })

  it("an update's refusal carries the server's message, and a network failure rejects", async () => {
    fetchMock.mockResolvedValueOnce(answer({ success: false, error: 'gone' }, 404))
    expect(await updateForecast('7', { name: 'x', scenarioData: {} })).toEqual({
      success: false,
      error: 'gone',
      status: 404,
    })
    fetchMock.mockResolvedValueOnce(answer('<html>502</html>', 502))
    expect(await updateForecast('7', { name: 'x', scenarioData: {} })).toEqual({
      success: false,
      error: 'Failed to save forecast',
      status: 502,
    })
    fetchMock.mockResolvedValueOnce(answer({ success: true, data: { id: 7 } }))
    expect(await updateForecast('7', { name: 'x', scenarioData: {} })).toEqual({
      success: true,
      data: { id: 7 },
      status: 200,
    })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(updateForecast('7', { name: 'x', scenarioData: {} })).rejects.toThrow(
      'Failed to fetch'
    )
  })
})

describe('answers', () => {
  it('passes a success through', async () => {
    fetchMock.mockResolvedValue(answer({ success: true, data: [{ id: 'p1', isDefault: true }] }))
    expect(await fetchProfiles()).toEqual({ success: true, data: [{ id: 'p1', isDefault: true }] })
  })

  it("a refusal carries the server's message, whatever the status", async () => {
    fetchMock.mockResolvedValue(
      answer(
        { success: false, error: 'A forecast with this name already exists for this profile.' },
        409
      )
    )
    expect(await saveForecast({ name: 'x', scenarioData: {}, profileId: 'p' })).toEqual({
      success: false,
      error: 'A forecast with this name already exists for this profile.',
    })
  })

  it('a non-OK status is a failure even if the body claims success', async () => {
    fetchMock.mockResolvedValue(answer({ success: true, data: [] }, 500))
    expect(await fetchForecasts()).toEqual({ success: false, error: 'Failed to load forecasts' })
  })

  it.each([
    ['an HTML error page', '<html>502 Bad Gateway</html>', 502],
    ['an empty body', '', 200],
    ['JSON that is not an ApiResult', { hello: 'world' }, 200],
  ])('%s becomes a fallback failure, not a throw', async (_label, body, status) => {
    fetchMock.mockResolvedValue(answer(body, status))
    expect(await saveForecast({ name: 'x', scenarioData: {}, profileId: 'p' })).toEqual({
      success: false,
      error: 'Failed to save forecast',
    })
  })

  it('a network failure REJECTS, for the page’s catch arms', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchProfiles()).rejects.toThrow('Failed to fetch')
  })
})
