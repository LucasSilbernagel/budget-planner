/**
 * EthicalAds widget tests (story 4-11, AC-1 / FR20).
 *
 * Covers: the ad surface renders only when a publisher id is configured, carries
 * the correct EthicalAds placeholder attributes, triggers the script's DOM
 * re-scan, sets NO cookies (privacy / NFR7), and degrades to nothing on error.
 * The script-loading module is mocked so no real network/DOM injection occurs.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const load = vi.fn()
const loadEthicalAdsScript = vi.fn<() => Promise<void>>(() => Promise.resolve())
const getEthicalAds = vi.fn<() => { load: () => void } | undefined>(() => ({ load }))

vi.mock('../../../lib/ads/client', () => ({
  loadEthicalAdsScript: () => loadEthicalAdsScript(),
  getEthicalAds: () => getEthicalAds(),
}))

import { EthicalAds } from '../EthicalAds'

const PUBLISHER_ID = 'pub-test-123'

beforeEach(() => {
  vi.clearAllMocks()
  loadEthicalAdsScript.mockResolvedValue(undefined)
  getEthicalAds.mockReturnValue({ load })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('EthicalAds', () => {
  it('renders nothing — no empty landmark — when no publisher id is configured', () => {
    vi.stubEnv('VITE_ETHICALADS_PUBLISHER_ID', '')
    const { container } = render(<EthicalAds />)
    expect(container).toBeEmptyDOMElement()
    // The "Advertisement" landmark must NOT exist when there is no ad to show.
    expect(screen.queryByRole('complementary', { name: /advertisement/i })).not.toBeInTheDocument()
    expect(loadEthicalAdsScript).not.toHaveBeenCalled()
  })

  it('renders nothing when the publisher id is only whitespace', () => {
    vi.stubEnv('VITE_ETHICALADS_PUBLISHER_ID', '   ')
    const { container } = render(<EthicalAds />)
    expect(container).toBeEmptyDOMElement()
    expect(loadEthicalAdsScript).not.toHaveBeenCalled()
  })

  it('renders the placeholder inside a labelled "Advertisement" landmark', async () => {
    vi.stubEnv('VITE_ETHICALADS_PUBLISHER_ID', PUBLISHER_ID)
    render(<EthicalAds type="text" />)

    // The skippable landmark exists only when an ad surface actually renders.
    const region = await screen.findByRole('complementary', { name: /advertisement/i })
    const slot = screen.getByTestId('ethical-ads')
    expect(region).toContainElement(slot)
    expect(slot).toHaveAttribute('data-ea-publisher', PUBLISHER_ID)
    expect(slot).toHaveAttribute('data-ea-type', 'text')
  })

  it('defaults to image creatives', async () => {
    vi.stubEnv('VITE_ETHICALADS_PUBLISHER_ID', PUBLISHER_ID)
    render(<EthicalAds />)
    expect(await screen.findByTestId('ethical-ads')).toHaveAttribute('data-ea-type', 'image')
  })

  it('loads the script and re-scans the DOM once mounted', async () => {
    vi.stubEnv('VITE_ETHICALADS_PUBLISHER_ID', PUBLISHER_ID)
    render(<EthicalAds />)

    await waitFor(() => expect(loadEthicalAdsScript).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  })

  it('sets no cookies (privacy / no invasive tracking)', async () => {
    vi.stubEnv('VITE_ETHICALADS_PUBLISHER_ID', PUBLISHER_ID)
    document.cookie = '' // start clean
    render(<EthicalAds />)

    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(document.cookie).toBe('')
  })

  it('renders nothing — no empty landmark — when the script fails to load', async () => {
    vi.stubEnv('VITE_ETHICALADS_PUBLISHER_ID', PUBLISHER_ID)
    loadEthicalAdsScript.mockRejectedValueOnce(new Error('boom'))

    const { container } = render(<EthicalAds />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})
