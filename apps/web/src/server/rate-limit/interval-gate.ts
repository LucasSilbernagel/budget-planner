/**
 * Per-process and reset on cold start, deliberately: scale-to-zero leaves no timer host,
 * so callers piggyback on requests and the first one after a wake passes.
 */

export interface IntervalGate {
	/** 0 = never passed, so the first call passes. */
	lastPassedAt: number
}

export function createIntervalGate(): IntervalGate {
	return { lastPassedAt: 0 }
}

/** `now` is injected so callers stay testable without fake timers. */
export function passIfDue(gate: IntervalGate, intervalMs: number, now: number): boolean {
	if (gate.lastPassedAt !== 0 && now - gate.lastPassedAt < intervalMs) {
		return false
	}
	gate.lastPassedAt = now
	return true
}
