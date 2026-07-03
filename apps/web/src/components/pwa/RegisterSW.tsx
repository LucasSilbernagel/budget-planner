import { useEffect } from 'react'

/**
 * Registers the service worker on the client (story 7-1, AC-3/AC-4).
 *
 * The SW is registered via vite-plugin-pwa's `virtual:pwa-register` module,
 * which touches `navigator`/`window`. To keep the SSR pass from ever evaluating
 * it, the virtual module is pulled with a dynamic `import()` inside an effect —
 * effects only run on the client, after mount. Renders nothing (pure wiring).
 */
export function RegisterSW() {
  useEffect(() => {
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        registerSW({ immediate: true })
      })
      .catch((error) => {
        // Registration is best-effort wiring. A failed chunk load (e.g. a stale
        // client fetching a since-redeployed virtual-register chunk) or a throwing
        // registerSW must not surface as an unhandled promise rejection.
        console.error('[RegisterSW] service worker registration failed:', error)
      })
  }, [])
  return null
}
