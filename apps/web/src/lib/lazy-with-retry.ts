import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'

/**
 * React.lazy caches a rejected import forever; retry so a transient failure (or a 404 after a
 * service-worker takeover) is not permanent for the session.
 */
// biome-ignore lint/suspicious/noExplicitAny: mirrors React.lazy's own constraint
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  { retries = 2, delayMs = 350 }: { retries?: number; delayMs?: number } = {}
): LazyExoticComponent<T> {
  return lazy(async () => {
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await factory()
      } catch (error) {
        lastError = error
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
        }
      }
    }
    throw lastError
  })
}
