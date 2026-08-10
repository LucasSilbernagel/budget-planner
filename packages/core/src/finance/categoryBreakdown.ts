/**
 * Per-category breakdown (story 30.5, FR54 part 2).
 *
 * WHY THIS IS A NEW MODULE rather than an extension of `visualization.ts`.
 * The aggregators already there (`aggregateByCategory`,
 * `aggregateByCategoryAndType`) look like exactly this, and are not:
 *
 *   1. THEY KEY ON A NAME — `item.category ?? item.name` — so a row with no
 *      resolvable category falls back to its own name and every uncategorized
 *      row becomes its own bucket. That is the overview pies' Decision 10, and
 *      undoing it for THIS surface is the entire point of the story: here,
 *      every row whose `categoryId` is null (or points at a category this
 *      device cannot resolve) rolls into ONE explicit `Uncategorized` bucket.
 *   2. THEY DO NOT NORMALIZE FREQUENCY — they sum raw entered amounts, so a
 *      weekly $100 and an annual $100 count equally. Callers had to normalize
 *      before calling in, and one that forgot shipped exactly that bug.
 *
 * The two surfaces therefore group DIFFERENTLY on purpose: the pies still merge
 * by resolved name, this breakdown merges by id. That is a deliberate product
 * decision (Decision 1, 2026-08-10), not drift — do not "fix" one to match the
 * other.
 *
 * ⚠️ ROUNDING ORDER IS LOAD-BEARING. Normalize per item (matching
 * `calculateTotalMonthlyNormalized`, which rounds each item and sums in monthly
 * space), then denormalize ONCE per bucket, then derive the grand total from
 * the buckets. Denormalizing per item would add a second per-item `Math.round`
 * whose drift is unbounded in the item count, and computing the grand total
 * independently would let the rows stop summing to the total displayed beside
 * them.
 *
 * ⚠️ CONSEQUENCE, ACCEPTED AND STATED: at `weekly` cadence this total can
 * differ by a few cents from the Financial Overview card, which rounds ONCE
 * over the whole set (`denormalizeFromMonthly(calculateTotalMonthlyNormalized(
 * items), duration)`). Seven $100/month items in seven categories come out
 * 16156 here and 16154 there. `monthly` and `annually` are exact because ×1 and
 * ×12 are integral. A breakdown whose rows do not sum to its own total is the
 * worse failure, so this is the trade taken.
 *
 * Architecture: pure functions, no side effects. Money is integer cents.
 */

import { type Frequency, denormalizeFromMonthly, normalizeToMonthly } from './normalization'

/** One row of a side's breakdown. `categoryId === null` is the Uncategorized bucket. */
export interface CategoryBreakdownRow {
  categoryId: string | null
  label: string
  /** In cents, at the requested cadence. */
  totalCents: number
  /**
   * 0–100, UNROUNDED. Display quantizes; the math input never does (NFR3).
   *
   * ⚠️ Measured as |row| / |side total|, the shipped `getPercentageOfTotal`
   * shape. Shares therefore do NOT sum to 100 when rows have opposite signs —
   * a +100 / −50 pair yields 200% and 100%. Negative amounts are a supported,
   * unit-tested state in this codebase, so this is reachable; consistency with
   * the shipped primitive wins over a special case here.
   */
  sharePercent: number
  count: number
}

export interface CategoryBreakdownItem {
  categoryId: string | null | undefined
  /** In cents, as entered at `frequency`. */
  amount: number
  frequency: Frequency
}

export interface CategoryBreakdownResult {
  rows: CategoryBreakdownRow[]
  /** In cents, at the requested cadence. EQUALS the sum of `rows[].totalCents`. */
  totalCents: number
}

export interface CategoryBreakdownOptions {
  /** Cadence every total is expressed at. */
  cadence: Frequency
  /** Label for the single residual bucket (e.g. "Uncategorized"). */
  uncategorizedLabel: string
}

/** A bucket mid-accumulation, still in MONTHLY space. */
interface Bucket {
  categoryId: string | null
  label: string
  monthlyCents: number // In cents, monthly-normalized
  count: number
}

/**
 * Group `items` by `categoryId`, expressing every total at `options.cadence`.
 *
 * Rows whose category does not resolve to a non-blank name in `names` — a null
 * id, an id absent from the map, a tombstoned or blank-named category — all
 * fold into ONE row with `categoryId: null`. That residual bucket always sorts
 * last; the rest sort by descending magnitude, ties broken by label ascending.
 *
 * A category present in `names` but used by no item produces NO row: this
 * enumerates rows, not categories.
 *
 * ⚠️ Throws on a non-finite amount or an unknown frequency (via the core
 * validators). That is deliberate — silently dropping a row would understate a
 * user's money. Callers reading unvalidated persisted data must pre-filter.
 */
export function buildCategoryBreakdown(
  items: CategoryBreakdownItem[],
  names: ReadonlyMap<string, string>,
  options: CategoryBreakdownOptions
): CategoryBreakdownResult {
  const { cadence, uncategorizedLabel } = options

  // Two containers rather than one map with a sentinel key: a sentinel string
  // could in principle collide with a real category id, and "in principle" is
  // how the uncategorized bucket would silently swallow a real category.
  const categorized = new Map<string, Bucket>()
  let uncategorized: Bucket | null = null

  for (const item of items) {
    // Validates and throws on malformed input before anything is accumulated.
    const monthlyCents = normalizeToMonthly(item.amount, item.frequency)

    // ⚠️ Both sides of the fallback are guarded. `??` is NULLISH, so a resolved
    // but blank name would otherwise pass straight through and produce a row
    // labelled '' — the live blank-label bug `resolveCategoryLabel` exists for.
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

  // ONE denormalization per bucket. `cadence` is validated here (an unknown
  // value throws) even when there are no categorized buckets, because the
  // residual bucket goes through the same call.
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
    // ⚠️ EQUAL MAGNITUDE AND EQUAL LABEL IS REACHABLE, so the label tie-break
    // alone does not make this sort TOTAL. Two ids from different profiles can
    // resolve to the same name (the breakdown resolves through the UNSCOPED
    // name map by design), and returning 0 there would leave the order at input
    // order — i.e. store insertion order, which can legitimately differ between
    // devices holding identical data. Fall back to the id.
    const aId = a.categoryId ?? ''
    const bId = b.categoryId ?? ''
    if (aId === bId) {
      return 0
    }
    return aId < bId ? -1 : 1
  })

  // The residual is not a category, so it never competes on size — it is always
  // the last row.
  if (uncategorized !== null) {
    ordered.push(toRow(uncategorized))
  }

  // Derived from the buckets, never computed independently: this is what makes
  // the rows sum to the total rendered beside them.
  const totalCents = ordered.reduce((sum, row) => sum + row.totalCents, 0)

  // Same 0-guard shape as `getPercentageOfTotal`: a side totalling 0 cents
  // yields 0, never NaN and never Infinity.
  const rows: CategoryBreakdownRow[] = ordered.map((row) => ({
    ...row,
    sharePercent: totalCents === 0 ? 0 : (Math.abs(row.totalCents) / Math.abs(totalCents)) * 100,
  }))

  return { rows, totalCents }
}
