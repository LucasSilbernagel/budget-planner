import { render } from '@testing-library/react'
import { type Mock, afterEach, describe, expect, it, vi } from 'vitest'
import { RegisterSW } from '../RegisterSW'
// The same module instance the component imports (via the vitest alias), so the spy sees the real call.
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
