import { useEffect } from 'react'

// Dynamic import inside an effect keeps virtual:pwa-register (touches navigator) out of SSR.
export function RegisterSW() {
  useEffect(() => {
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        registerSW({ immediate: true })
      })
      .catch((error) => {
        // Best effort: a stale chunk or a throwing registerSW must not become an unhandled rejection.
        console.error('[RegisterSW] service worker registration failed:', error)
      })
  }, [])
  return null
}
