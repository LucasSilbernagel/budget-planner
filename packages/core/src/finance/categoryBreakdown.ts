// Groups by categoryId (the overview pies group by name, on purpose). At weekly cadence the total
// can differ from the overview card by a few cents: rows summing to their own total wins.

import { type Frequency, denormalizeFromMonthly, normalizeToMonthly } from './normalization'

export interface CategoryBreakdownRow {
  categoryId: string | null
  label: string
  totalCents: number
  // UNROUNDED. |row| / |side total|, so shares don't sum to 100 when rows have opposite signs.
  sharePercent: number
  count: number
}

export interface CategoryBreakdownItem {
  categoryId: string | null | undefined
  amount: number
  frequency: Frequency
}

export interface CategoryBreakdownResult {
  rows: CategoryBreakdownRow[]
  totalCents: number
}

export interface CategoryBreakdownOptions {
  cadence: Frequency
  uncategorizedLabel: string
}

interface Bucket {
  categoryId: string | null
  label: string
  monthlyCents: number
  count: number
}

// Throws on non-finite amounts or unknown frequencies rather than silently understating money;
// callers reading unvalidated persisted data must pre-filter.
export function buildCategoryBreakdown(
  items: CategoryBreakdownItem[],
  names: ReadonlyMap<string, string>,
  options: CategoryBreakdownOptions
): CategoryBreakdownResult {
  const { cadence, uncategorizedLabel } = options

  // Two containers, not a sentinel key that could collide with a real category id.
  const categorized = new Map<string, Bucket>()
  let uncategorized: Bucket | null = null

  for (const item of items) {
    const monthlyCents = normalizeToMonthly(item.amount, item.frequency)

    // `??` is nullish, so a resolved but blank name must be guarded too.
    let categoryId: string | null = null
    let label = uncategorizedLabel
    if (item.categoryId) {
      const resolved = names.get(item.categoryId)?.trim()
      if (resolved !== undefined && resolved.length > 0) {
        categoryId = item.categoryId
        label = resolved
      }
    }

    if (categoryId === null) {
      uncategorized = uncategorized ?? { categoryId: null, label, monthlyCents: 0, count: 0 }
      uncategorized.monthlyCents += monthlyCents
      uncategorized.count += 1
      continue
    }

    const existing = categorized.get(categoryId)
    if (existing) {
      existing.monthlyCents += monthlyCents
      existing.count += 1
    } else {
      categorized.set(categoryId, { categoryId, label, monthlyCents, count: 1 })
    }
  }

  // ONE denormalization per bucket (per item adds unbounded rounding drift). Validates `cadence`
  // even with no categorized buckets.
  const toRow = (bucket: Bucket): Omit<CategoryBreakdownRow, 'sharePercent'> => ({
    categoryId: bucket.categoryId,
    label: bucket.label,
    totalCents: denormalizeFromMonthly(bucket.monthlyCents, cadence),
    count: bucket.count,
  })

  const ordered = [...categorized.values()].map(toRow).sort((a, b) => {
    const magnitude = Math.abs(b.totalCents) - Math.abs(a.totalCents)
    if (magnitude !== 0) {
      return magnitude
    }
    // Code-unit comparison, not `localeCompare`: ordering must be identical on
    // every machine, and tests depend on it being total and stable.
    if (a.label !== b.label) {
      return a.label < b.label ? -1 : 1
    }
    // Equal magnitude AND label is reachable across profiles, so fall back to the id; otherwise
    // order follows per-device insertion order.
    const aId = a.categoryId ?? ''
    const bId = b.categoryId ?? ''
    if (aId === bId) {
      return 0
    }
    return aId < bId ? -1 : 1
  })

  if (uncategorized !== null) {
    ordered.push(toRow(uncategorized))
  }

  // Derived from the buckets, never computed independently: this is what makes
  // the rows sum to the total rendered beside them.
  const totalCents = ordered.reduce((sum, row) => sum + row.totalCents, 0)

  const rows: CategoryBreakdownRow[] = ordered.map((row) => ({
    ...row,
    sharePercent: totalCents === 0 ? 0 : (Math.abs(row.totalCents) / Math.abs(totalCents)) * 100,
  }))

  return { rows, totalCents }
}
