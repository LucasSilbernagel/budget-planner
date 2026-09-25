/**
 * "At most once per interval, per process" gate (Story sec-3).
 *
 * Two callers need this shape and neither can use a timer: under Rapids
 * scale-to-zero (`apps/web/rapids-service.yaml:49`, `min-scale: "0"`) there is
 * no background process to hang one on, so both piggyback on request traffic.
 *
 *  - `client-ip.ts` rate-limits its "no trustworthy client IP" log, so a flood
 *    of header-less requests cannot become a log-amplification vector. That
 *    vector is why the line it replaces used `logger.debug` — but `debug` is
 *    DROPPED in production (`lib/logger.ts:157` floors the level at `info`),
 *    which would make the log silent exactly where it is meant to be read.
 *    Gating an `info` keeps both properties.
 *  - `db-window.ts` bounds how often the expired-window reaper sweeps.
 *
 * State is module-level, so it is per-instance and RESETS on a cold start.
 * Under scale-to-zero that is deliberate, not a leak: the first request after a
 * wake logs and sweeps, which is when the information is most useful.
 */

export interface IntervalGate {
  /** Epoch ms of the last pass. 0 = never passed, so the first call passes. */
  lastPassedAt: number
}

export function createIntervalGate(): IntervalGate {
  return { lastPassedAt: 0 }
}

/**
 * True at most once per `intervalMs`. Mutates `gate` when it returns true.
 *
 * `now` is injected rather than read here so callers stay testable without fake
 * timers (the project's suites mock modules, not the clock).
 */
export function passIfDue(gate: IntervalGate, intervalMs: number, now: number): boolean {
  if (gate.lastPassedAt !== 0 && now - gate.lastPassedAt < intervalMs) {
    return false
  }
  gate.lastPassedAt = now
  return true
}
