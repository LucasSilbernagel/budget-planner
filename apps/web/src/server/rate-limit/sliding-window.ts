/**
 * Generic per-key sliding-window rate limiter (Story 5-16, extracted from the
 * Story 5-8 Paddle callback limiter).
 *
 * Keeps an independent attempt log per key and enforces `maxAttempts` within
 * `windowMs`. A hard `maxKeys` bound prevents a key-flood (e.g. spoofed IPs or a
 * dictionary of emails) from growing the map without limit: at capacity, expired
 * buckets are swept, and if still full a brand-new key is allowed through
 * (degrade OPEN) rather than tracked — already-tracked keys stay limited.
 *
 * SECURITY: in-memory and single-instance. This is defense-in-depth ONLY — the
 * real access control is the signed session + DB-authoritative subscription, and
 * (for magic links) the single-use DB token. Under Rapids horizontal scaling the
 * counter is not shared across instances; a shared/edge store is the production
 * upgrade (tracked in deferred-work.md, pairs with 5-2).
 */

export interface SlidingWindowLimiterOptions {
  /** Window length in milliseconds. */
  windowMs: number
  /** Maximum attempts permitted per key within the window. */
  maxAttempts: number
  /** Hard cap on distinct keys tracked at once (memory bound). */
  maxKeys: number
}

export interface SlidingWindowLimiter {
  /**
   * Record an attempt for `key` at time `now` (epoch ms) and report whether it
   * should be REJECTED (true = limit already reached for this window).
   */
  check(key: string, now: number): boolean
  /** Clear all tracked state (tests / graceful reset). */
  reset(): void
}

export function createSlidingWindowLimiter(
  options: SlidingWindowLimiterOptions
): SlidingWindowLimiter {
  const { windowMs, maxAttempts, maxKeys } = options
  const attempts = new Map<string, number[]>()

  /** Drop every key bucket whose attempts have all aged out of the window. */
  function sweepExpired(windowStart: number): void {
    for (const [key, timestamps] of attempts) {
      if (timestamps.every((ts) => ts <= windowStart)) {
        attempts.delete(key)
      }
    }
  }

  return {
    check(key: string, now: number): boolean {
      const windowStart = now - windowMs
      const recent = (attempts.get(key) ?? []).filter((ts) => ts > windowStart)

      if (recent.length >= maxAttempts) {
        // Persist the pruned list so the window keeps sliding without growth.
        attempts.set(key, recent)
        return true
      }

      // Memory bound: before allocating a bucket for a NEW key at capacity,
      // sweep expired entries; if still full, refuse to track it (degrade open)
      // rather than let the map grow without limit. Tracked keys stay limited.
      if (!attempts.has(key) && attempts.size >= maxKeys) {
        sweepExpired(windowStart)
        if (attempts.size >= maxKeys) {
          return false
        }
      }

      recent.push(now)
      attempts.set(key, recent)
      return false
    },
    reset(): void {
      attempts.clear()
    },
  }
}
