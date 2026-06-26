/**
 * EthicalAds client tests (story 4-11).
 *
 * Covers the script-loading side effect in isolation: idempotent injection,
 * reuse of an existing/loaded script, and retry after failure. These run in
 * jsdom (`.dom.test.ts`) because they touch `document`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ETHICALADS_SCRIPT_ID,
  ETHICALADS_SCRIPT_URL,
  getEthicalAds,
  loadEthicalAdsScript,
  resetEthicalAdsScriptState,
} from '../client'

function cleanup(): void {
  resetEthicalAdsScriptState()
  document.getElementById(ETHICALADS_SCRIPT_ID)?.remove()
  // biome-ignore lint/performance/noDelete: test cleanup of the injected global.
  delete (window as unknown as { ethicalads?: unknown }).ethicalads
}

beforeEach(cleanup)
afterEach(cleanup)

describe('loadEthicalAdsScript', () => {
  it('injects the EthicalAds script tag exactly once', async () => {
    const p1 = loadEthicalAdsScript()
    const p2 = loadEthicalAdsScript()

    expect(p1).toBe(p2) // concurrent callers share one in-flight promise

    const scripts = document.querySelectorAll(`#${ETHICALADS_SCRIPT_ID}`)
    expect(scripts).toHaveLength(1)

    const script = document.getElementById(ETHICALADS_SCRIPT_ID) as HTMLScriptElement
    expect(script.src).toBe(ETHICALADS_SCRIPT_URL)
    expect(script.async).toBe(true)

    // Simulate the browser finishing the load so the promise settles.
    script.onload?.(new Event('load'))
    await expect(p1).resolves.toBeUndefined()
  })

  it('resolves immediately when the global is already present (no injection)', async () => {
    ;(window as unknown as { ethicalads: { load: () => void } }).ethicalads = { load: () => {} }

    await expect(loadEthicalAdsScript()).resolves.toBeUndefined()
    expect(document.getElementById(ETHICALADS_SCRIPT_ID)).toBeNull()
  })

  it('rejects on error, removes the dead tag, and lets a later call re-inject cleanly', async () => {
    const p1 = loadEthicalAdsScript()
    const script = document.getElementById(ETHICALADS_SCRIPT_ID) as HTMLScriptElement
    script.onerror?.(new Event('error'))

    await expect(p1).rejects.toThrow(/Failed to load EthicalAds/)

    // The failed tag is removed automatically (no stale tag for a later call to
    // short-circuit on), and the cache is cleared.
    expect(document.getElementById(ETHICALADS_SCRIPT_ID)).toBeNull()

    const p2 = loadEthicalAdsScript()
    expect(p2).not.toBe(p1)
    expect(document.getElementById(ETHICALADS_SCRIPT_ID)).not.toBeNull()
  })

  it('attaches to a pre-existing script tag instead of resolving blindly', async () => {
    // A tag exists (injected elsewhere) but the global is not ready yet.
    const tag = document.createElement('script')
    tag.id = ETHICALADS_SCRIPT_ID
    document.head.appendChild(tag)

    let resolved = false
    const p = loadEthicalAdsScript()
    p.then(() => {
      resolved = true
    })

    // No duplicate injection, and not resolved until the existing tag loads.
    expect(document.querySelectorAll(`#${ETHICALADS_SCRIPT_ID}`)).toHaveLength(1)
    await Promise.resolve()
    expect(resolved).toBe(false)

    tag.onload?.(new Event('load'))
    await expect(p).resolves.toBeUndefined()
  })
})

describe('getEthicalAds', () => {
  it('returns undefined when the script has not loaded', () => {
    expect(getEthicalAds()).toBeUndefined()
  })

  it('returns the global once present', () => {
    const fake = { load: () => {} }
    ;(window as unknown as { ethicalads: typeof fake }).ethicalads = fake
    expect(getEthicalAds()).toBe(fake)
  })
})
