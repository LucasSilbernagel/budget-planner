/**
 * Tests for the client-only PWA service-worker registrar (story 7-1).
 *
 * `virtual:pwa-register` is a vite-plugin-pwa virtual module with no real
 * implementation under Vitest; vitest.config.ts aliases it to a spyable double
 * (src/test/pwa-register-mock.ts). The component must render nothing and call
 * `registerSW({ immediate: true })` in an effect.
 */

import { render } from '@testing-library/react'
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest'
import { RegisterSW } from '../RegisterSW'
// Resolves to src/test/pwa-register-mock.ts via the vitest alias — the same
// module instance the component imports, so the spy observes the real call.
import { registerSW } from 'virtual:pwa-register'

const registerSWMock = registerSW as unknown as Mock

afterEach(() => {
  registerSWMock.mockClear()
})

describe('RegisterSW', () => {
  it('renders nothing', () => {
    const { container } = render(<RegisterSW />)
    expect(container).toBeEmptyDOMElement()
  })

  it('registers the service worker immediately in an effect', async () => {
    render(<RegisterSW />)
    // The dynamic import resolves on a microtask; wait for it.
    await vi.waitFor(() => expect(registerSWMock).toHaveBeenCalledTimes(1))
    expect(registerSWMock).toHaveBeenCalledWith({ immediate: true })
  })
})
