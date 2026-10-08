/**
 * A mount gate, not persist.hasHydrated(): stores fill before route components render, so that is
 * true on the first client render but false on the server. Requires synchronous storage everywhere.
 */

import { useEffect, useState } from 'react'

/**
 * Module-scoped so client navigations do not remount into skeletons. Written only from an effect,
 * so it stays false on the server and cannot leak between requests.
 */
let hydratedOnThisClient = false

export function useStoresHydrated(): boolean {
  const [hydrated, setHydrated] = useState(hydratedOnThisClient)

  useEffect(() => {
    hydratedOnThisClient = true
    setHydrated(true)
  }, [])

  return hydrated
}

/** Call in beforeEach of files that mix render() with renderToString(): render() sets the flag. */
export function __resetStoresHydratedForTests(): void {
  hydratedOnThisClient = false
}
