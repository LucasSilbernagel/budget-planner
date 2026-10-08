/**
 * Core throws on an unknown frequency or non-finite amount, and persisted/synced rows are unvalidated.
 * Unreadable rows are excluded and counted for disclosure rather than coerced into an invented total.
 */

import type { Frequency } from '@budget-planner/core'

/** Runtime set: `Frequency` is erased, so persisted strings must be checked against real values. */
const KNOWN_FREQUENCIES: ReadonlySet<string> = new Set<Frequency>([
  'weekly',
  'biweekly',
  'monthly',
  'annually',
])

export interface NormalizableItem {
  amount: number
  frequency: Frequency
}

/** getNormalizationMultiplier returns undefined (no throw) on an unknown cadence, so an unguarded sort key yields NaN. */
export function isKnownFrequency(frequency: unknown): frequency is Frequency {
  return typeof frequency === 'string' && KNOWN_FREQUENCIES.has(frequency)
}

/**
 * The non-object arm is load-bearing: zustand runs migrate only on a version mismatch, so null elements can reach state.
 * Number.isFinite also rejects ±Infinity, matching core.
 */
export function isReadableRow(row: unknown): row is NormalizableItem {
  if (typeof row !== 'object' || row === null) {
    return false
  }
  const { amount, frequency } = row as { amount?: unknown; frequency?: unknown }
  return (
    typeof frequency === 'string' &&
    KNOWN_FREQUENCIES.has(frequency) &&
    typeof amount === 'number' &&
    Number.isFinite(amount)
  )
}

export function toNormalizableItems(rows: readonly unknown[]): NormalizableItem[] {
  return rows.filter(isReadableRow).map((row) => ({
    amount: row.amount,
    frequency: row.frequency,
  }))
}

export function countUnreadableRows(rows: readonly unknown[]): number {
  return rows.reduce<number>((count, row) => (isReadableRow(row) ? count : count + 1), 0)
}

/**
 * rawTotalCents sums readable rows only, and conversionApplied is explicit:
 * normalized == raw can still happen after a real conversion.
 */
export interface ReadableRowsSummary {
  rawTotalCents: number
  unreadableCount: number
  conversionApplied: boolean
}

export function summarizeReadableRows(rows: readonly unknown[]): ReadableRowsSummary {
  const readable = toNormalizableItems(rows)
  return {
    rawTotalCents: readable.reduce((sum, row) => sum + row.amount, 0),
    unreadableCount: rows.length - readable.length,
    conversionApplied: readable.some((row) => row.frequency !== 'monthly'),
  }
}
