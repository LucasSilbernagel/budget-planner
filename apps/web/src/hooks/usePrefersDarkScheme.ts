/**
 * Only for Recharts, which takes chart colours as JS values; everything else should use `dark:`
 * utilities.
 */
import { useEffect, useState } from 'react'

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

export function usePrefersDarkScheme(): boolean {
  const [prefersDark, setPrefersDark] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const query = window.matchMedia(DARK_SCHEME_QUERY)
    const update = () => setPrefersDark(query.matches)

    update()

    // addEventListener is missing on iOS Safari <14 / legacy Android; calling it would throw.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update)
      return () => query.removeEventListener('change', update)
    }
    query.addListener(update)
    return () => query.removeListener(update)
  }, [])

  return prefersDark
}
