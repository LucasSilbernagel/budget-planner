/**
 * Order is sortOrder, createdAt, id: all device-independent, so duplicate sortOrders from offline
 * merges resolve to the same order everywhere.
 */

import { PG_INT32_MAX } from '@budget-planner/core/sync/types'

export interface DisplayOrdered {
  id?: string
  sortOrder?: number
  createdAt?: string
}

const LAST = Number.POSITIVE_INFINITY

/** Missing counts as last, not 0, so legacy rows never jump to the top and fall through to createdAt. */
function orderKey(row: DisplayOrdered | null | undefined): number {
  const value = row?.sortOrder
  return typeof value === 'number' && Number.isFinite(value) ? value : LAST
}

function createdKey(row: DisplayOrdered | null | undefined): number {
  const raw = row?.createdAt
  if (typeof raw !== 'string') {
    return LAST
  }
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : LAST
}

/** Plain `<`/`>`, not localeCompare: the tiebreaker must order identically in every locale. */
function idKey(row: DisplayOrdered | null | undefined): string {
  const value = row?.id
  return typeof value === 'string' ? value : ''
}

export function sortByDisplayOrder<T extends DisplayOrdered>(rows: readonly T[] | null): T[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return [...rows].sort((a, b) => {
    // Compared, never subtracted: `Infinity - Infinity` is NaN.
    const orderA = orderKey(a)
    const orderB = orderKey(b)
    if (orderA !== orderB) {
      return orderA < orderB ? -1 : 1
    }
    const createdA = createdKey(a)
    const createdB = createdKey(b)
    if (createdA !== createdB) {
      return createdA < createdB ? -1 : 1
    }
    const idA = idKey(a)
    const idB = idKey(b)
    if (idA === idB) {
      return 0
    }
    return idA < idB ? -1 : 1
  })
}

/**
 * Must match the SQL backfill (dense 0..n-1 by createdAt, then id). zustand migrates on any version
 * mismatch, so existing positions are kept.
 */
export function backfillSortOrder<T extends DisplayOrdered>(rows: readonly T[] | null): T[] {
  return sortByDisplayOrder(rows).map((row, index) => ({ ...row, sortOrder: index }))
}

/**
 * `max + 1`, not length: deletes leave gaps. Clamped to [0, PG_INT32_MAX] because the sync gates
 * reject anything else and the client-side rejection is swallowed.
 */
export function nextSortOrder(rows: readonly DisplayOrdered[] | null): number {
  if (!Array.isArray(rows)) {
    return 0
  }
  let max: number | null = null
  for (const row of rows) {
    const value = row?.sortOrder
    if (typeof value === 'number' && Number.isFinite(value) && (max === null || value > max)) {
      max = value
    }
  }
  if (max === null) {
    return 0
  }
  return Math.min(PG_INT32_MAX, Math.max(0, Math.trunc(max) + 1))
}

/**
 * Stamps unpositioned rows above the current max without renumbering positions the server supplied.
 * At the ceiling stamped rows tie and fall back to createdAt, then id.
 */
export function stampMissingSortOrder<T extends DisplayOrdered>(rows: readonly T[] | null): T[] {
  const sorted = sortByDisplayOrder(rows)
  if (sorted.every((row) => typeof row?.sortOrder === 'number' && Number.isFinite(row.sortOrder))) {
    return sorted
  }
  let next = nextSortOrder(sorted)
  return sorted.map((row) => {
    const value = row?.sortOrder
    if (typeof value === 'number' && Number.isFinite(value)) {
      return row
    }
    const stamped = { ...row, sortOrder: next }
    // Clamped per row, not only at the seed.
    next = Math.min(PG_INT32_MAX, next + 1)
    return stamped
  })
}
