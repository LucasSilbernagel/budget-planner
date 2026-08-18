/**
 * Shared display-order helpers for the four financial lists (Story 34.1a, FR60).
 *
 * Before this story the four lists had two competing, contradictory notions of
 * order: income/expense used raw array position (nothing sorted them at all),
 * while savings/balance re-sorted by `createdAt` DESCENDING on every add AND
 * every update via core's `sortByCreationDate`. This module replaces both with
 * ONE rule, applied at every write path and after every pull:
 *
 *     sortOrder ASC  ->  createdAt ASC  ->  id ASC
 *
 * ⚠️ ALL THREE KEYS ARE DEVICE-INDEPENDENT, and that is the whole design. Two
 * devices that reorder the same list offline will legitimately produce DUPLICATE
 * `sortOrder` values — last-write-wins resolves each row independently, so the
 * merged list can hold two rows at position 3. There is deliberately no unique
 * constraint to prevent that (a unique index would make the losing insert fail at
 * the database). Instead both devices break the tie with `createdAt`, then `id`,
 * and therefore land on the SAME visible order without any coordination.
 *
 * `sortByCreationDate` in core is intentionally left in place and untouched — it
 * keeps its own direct test coverage. Only its four store call sites are retired.
 */

/**
 * The minimal shape these helpers order by. Every field except `id` is optional
 * because the input is ultimately untrusted persisted JSON: a hand-edited
 * localStorage blob, a truncated write, or a row written by an older build that
 * predates `sortOrder`.
 */
export interface DisplayOrdered {
  id?: string
  sortOrder?: number
  createdAt?: string
}

/**
 * Rows whose key is unusable sort LAST rather than first.
 *
 * Mirrors the `!Number.isFinite(...)` guard already in core's
 * `balanceTracking.sortByCreationDate` — deliberately NOT the savings variant,
 * which has no such guard and lets an invalid date produce `NaN` comparisons
 * (a comparator returning NaN is undefined behaviour and can leave the array in
 * an arbitrary order).
 */
const LAST = Number.POSITIVE_INFINITY

/**
 * Read a row's `sortOrder` as a finite number, or `LAST` when it is missing or
 * non-numeric.
 *
 * Treating an absent value as LAST rather than 0 matters twice over:
 *   - a legacy row cannot silently jump to the TOP of the user's list, and
 *   - when NO row has a `sortOrder` (a whole pre-34.1a array passed straight in)
 *     every row scores LAST, so the comparison falls through cleanly to
 *     `createdAt` ASC — which is exactly the intended pre-migration ordering.
 */
function orderKey(row: DisplayOrdered | null | undefined): number {
  const value = row?.sortOrder
  return typeof value === 'number' && Number.isFinite(value) ? value : LAST
}

/** Read a row's `createdAt` as an epoch-ms number, or `LAST` when unparseable. */
function createdKey(row: DisplayOrdered | null | undefined): number {
  const raw = row?.createdAt
  if (typeof raw !== 'string') {
    return LAST
  }
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : LAST
}

/**
 * Read a row's `id` for the final tiebreaker.
 *
 * ⚠️ Compared with plain `<`/`>`, NOT `localeCompare`. `localeCompare` is
 * locale-sensitive, so two devices with different locales could order the same
 * pair of ids differently — which would defeat the entire point of an
 * ID tiebreaker. Plain lexicographic comparison is identical everywhere.
 */
function idKey(row: DisplayOrdered | null | undefined): string {
  const value = row?.id
  return typeof value === 'string' ? value : ''
}

/**
 * Sort a list into its canonical display order. Non-mutating; safe on
 * null/undefined input and on arrays containing null entries.
 *
 * ⚠️ The `id` tiebreaker is load-bearing, not decorative. The client stamps
 * `createdAt` with `new Date().toISOString()` at millisecond precision, so two
 * rows added in the same millisecond — routine in tests and seeded fixtures —
 * collide on both `sortOrder` and `createdAt`. Without a third key the order of
 * those two rows would depend on the engine's sort stability and on their
 * incoming array position, i.e. it would not be reproducible across devices.
 */
export function sortByDisplayOrder<T extends DisplayOrdered>(rows: readonly T[] | null): T[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return [...rows].sort((a, b) => {
    // Compared, never subtracted: the LAST sentinel is Infinity, and
    // `Infinity - Infinity` is NaN — a comparator returning NaN is undefined
    // behaviour and can leave the array in an arbitrary order.
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
 * Assign every row a dense zero-based `sortOrder` in canonical display order.
 *
 * This is the CLIENT half of story 34.1a's AC-2 backfill, and it must stay
 * behaviourally identical to the hand-written SQL in
 * `packages/db/migrations/0013_purple_retro_girl.sql`:
 *
 *     dense 0..n-1, ordered createdAt ASC with id ASC as the tiebreaker.
 *
 * It is expressed here via {@link sortByDisplayOrder} rather than by sorting on
 * `createdAt` directly, and the two agree exactly on the case that matters: in a
 * pre-34.1a (v2) payload NO row carries a `sortOrder`, so every row scores LAST
 * and the comparison falls through to `createdAt` ASC then `id` ASC — the SQL's
 * rule precisely.
 *
 * Going through the display-order helper additionally makes the function safe on
 * a payload that DOES already carry positions. zustand runs `migrate` on any
 * version MISMATCH, not only an upgrade, so a payload written by a newer build
 * comes through here too; ordering by `sortOrder` first preserves the user's real
 * arrangement, where sorting by `createdAt` would silently destroy it and revert
 * the list to creation order.
 *
 * ⚠️ Callers must hand this an array already stripped of null/non-object rows.
 */
export function backfillSortOrder<T extends DisplayOrdered>(rows: readonly T[] | null): T[] {
  return sortByDisplayOrder(rows).map((row, index) => ({ ...row, sortOrder: index }))
}

/**
 * The `sortOrder` to assign to a row being appended: one past the highest value
 * currently in the list, or `0` when the list is empty.
 *
 * ⚠️ `max + 1`, deliberately NOT `list.length`. Deletes leave GAPS on purpose
 * (reindexing on delete would emit N sync updates for a single deletion), so
 * after deleting from the middle of a 3-row list `length` would be 2 — colliding
 * with the row already sitting at 2. `max + 1` is gap-tolerant by construction.
 *
 * ⚠️ Rows whose `sortOrder` is missing or non-numeric are IGNORED rather than
 * coerced. `Math.max(..., NaN)` is NaN, and a single hostile persisted row would
 * otherwise poison every subsequent insert with a NaN position — which the sync
 * zod gate then rejects, silently stranding the row.
 *
 * ⚠️ THE RESULT IS ALWAYS A NON-NEGATIVE INTEGER, and that clamp is load-bearing
 * rather than cosmetic (code review 34.1a). Both sync gates declare `sortOrder` as
 * `.int().min(0)`, and the client gate is enforced by a THROWING `parse` inside
 * `queueCreate`/`queueUpdate` whose rejection `syncBridge` swallows into a
 * `console.error`. So without the clamp a single hostile persisted row — say
 * `sortOrder: -5`, or a fractional `1.5` — would make every SUBSEQUENT add compute
 * an out-of-range position whose sync operation is never queued: the row renders
 * fine locally, and nothing surfaces the loss. `Math.max(0, Math.trunc(...))` keeps
 * the value inside the contract; a clamped collision is harmless because duplicates
 * are expected anyway and resolve via the read-time tiebreaker.
 *
 * Note: at the int32 ceiling `max + 1` would overflow the column; the sync gates
 * bound `sortOrder` to PG_INT32_MAX and reject it — loudly at the server gate, but
 * only as a swallowed `console.error` on the client queue gate. Reaching that
 * requires ~2.1 billion inserts into a single list.
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
  // Clamp INTO the sync contract rather than emitting a value the gates reject.
  return Math.max(0, Math.trunc(max) + 1)
}

/**
 * Give a position to any row that lacks one, leaving already-positioned rows
 * untouched (Story 34.1a, code review).
 *
 * ⚠️ THIS FIXES A CONFIRMED AC-3 VIOLATION, reproduced by probe. A row with no
 * `sortOrder` scores the `LAST` sentinel, but `nextSortOrder` over a list where NO
 * row carries a position returns `0` — and `0` beats `Infinity`, so a brand-new
 * local row landed at the **TOP** of the list instead of the bottom:
 *
 *     nextSortOrder = 0
 *     order = NEW-LOCAL , pulled-A , pulled-B
 *
 * That state is exactly what a pull produces while migration 0013 is unapplied:
 * server rows have no `sortOrder` column yet, and `applyOne` spreads the server row
 * in verbatim. Stamping on arrival makes the client self-healing.
 *
 * Deliberately NOT {@link backfillSortOrder}: renumbering every row would discard
 * positions the server DID supply. Unpositioned rows already sort last, so
 * assigning them values above the current max preserves the sorted order exactly.
 */
/**
 * Upper bound of a Postgres `integer`. Mirrors the private constant of the same
 * name in `packages/core/src/sync/types.ts`, which is not exported; both sync
 * gates declare `sortOrder` as `.int().min(0).max(PG_INT32_MAX)`.
 */
const PG_INT32_MAX = 2_147_483_647

/** Which way a row is being moved through the list. */
export type RowMoveDirection = 'up' | 'down'

/** A single row's new position, as produced by {@link planRowMove}. */
export interface RowPositionChange {
  id: string
  sortOrder: number
}

/** Is this a value both sync gates will accept? */
function isContractPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= PG_INT32_MAX
}

/** Apply a candidate plan to a copy and report whether it yields `expectedIds`. */
function producesOrder<T extends DisplayOrdered>(
  rows: readonly T[],
  changes: readonly RowPositionChange[],
  expectedIds: readonly string[]
): boolean {
  const byId = new Map(changes.map((change) => [change.id, change.sortOrder]))
  const applied = rows.map((row) => {
    const next = byId.get(idKey(row))
    return next === undefined ? row : { ...row, sortOrder: next }
  })
  const actual = sortByDisplayOrder(applied).map(idKey)
  return actual.length === expectedIds.length && actual.every((id, i) => id === expectedIds[i])
}

/**
 * Plan the position changes needed to move one row up or down by one place
 * (Story 34.1b, FR60). Pure: returns the changes, writes nothing.
 *
 * Returns `[]` for every no-op — an unknown id, a null/empty list, and both
 * boundaries (the first row cannot move up, the last cannot move down). Callers
 * can therefore treat an empty plan as "nothing happened" without re-deriving
 * the boundary rule, and the UI's disabled state and the store's guard stay in
 * agreement by construction rather than by two copies of the same condition.
 *
 * ⚠️ THE PREFERRED PLAN IS AN EXCHANGE OF THE TWO ROWS' POSITIONS — two writes,
 * and gaps left by earlier deletes are preserved (34.1a decision 3 and 5: do NOT
 * reindex, because reindexing emits one sync operation per row).
 *
 * ⚠️ BUT AN EXCHANGE IS NOT ALWAYS ENOUGH, AND THAT IS THE SUBTLE PART. Swapping
 * two EQUAL values is a no-op, so a list holding duplicate positions — which
 * 34.1a deliberately permits, because two devices reordering offline converge via
 * the `createdAt`/`id` tiebreakers rather than via a unique constraint — would
 * silently refuse to move. The same is true when a row's position is missing or
 * outside the sync contract, and when a THIRD row happens to hold the destination
 * value (the moved row would land tied with it, and the tiebreaker, not the user,
 * would decide where it settles).
 *
 * Rather than enumerate those cases and hope the list is exhaustive, the exchange
 * is PROPOSED and then VERIFIED against the order the user asked for. If it does
 * not reproduce that order exactly, the intended order is renumbered densely and
 * only the rows whose value actually changes are emitted. Correctness is
 * structural, and the degenerate list heals itself on first use.
 */
export function planRowMove<T extends DisplayOrdered>(
  rows: readonly T[] | null,
  id: string,
  direction: RowMoveDirection
): RowPositionChange[] {
  const sorted = sortByDisplayOrder(rows)
  // `idKey` rather than a raw `row?.id === id`: every other id comparison in
  // this module goes through it, and two lookup conventions in one function are
  // a defect waiting for the day they disagree.
  const from = sorted.findIndex((row) => idKey(row) === id)
  if (from === -1) {
    return []
  }
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= sorted.length) {
    // Boundary: communicated by the UI as aria-disabled, and a no-op here.
    return []
  }

  const moved = sorted[from]
  const neighbour = sorted[to]
  if (!moved || !neighbour) {
    return []
  }
  const movedId = idKey(moved)
  const neighbourId = idKey(neighbour)
  if (!movedId || !neighbourId || movedId === neighbourId) {
    // A row with no usable id cannot be addressed in a sync operation.
    return []
  }

  const intended = [...sorted]
  intended.splice(from, 1)
  intended.splice(to, 0, moved)
  const intendedIds = intended.map(idKey)

  const movedOrder = moved.sortOrder
  const neighbourOrder = neighbour.sortOrder
  if (
    isContractPosition(movedOrder) &&
    isContractPosition(neighbourOrder) &&
    movedOrder !== neighbourOrder
  ) {
    const exchange: RowPositionChange[] = [
      { id: movedId, sortOrder: neighbourOrder },
      { id: neighbourId, sortOrder: movedOrder },
    ]
    if (producesOrder(sorted, exchange, intendedIds)) {
      return exchange
    }
  }

  // MINIMAL renumber (code review): walk the intended order and raise only the
  // rows that must move to realize it, leaving every row that already sorts
  // correctly — and its delete-gap — untouched.
  //
  // ⚠️ THIS DELIBERATELY IS NOT A DENSE 0..n-1 RENUMBER. The first version was,
  // and review measured the cost on this story's own adversarial fixture
  // (`a(0,newest), b(2), c(2,oldest), d(5)`, move `a` down): it emitted THREE
  // changes including uninvolved row `d`, collapsing its 5 to a 3. That is the
  // reindexing ratified decision 5 and §9.6 exist to forbid, because every
  // emitted change is one more sync operation for a single click.
  //
  // Some third-row write IS forced here — no integer places `a` between two rows
  // tied at 2 whose tiebreak runs against it — but only the colliding neighbour
  // needs to move, not the whole list. Sweeping once and raising a row only when
  // it fails to outrank its predecessor is the smallest plan that realizes the
  // intended order, and it degrades to the dense case only for a list that is
  // entirely tied.
  const minimal: RowPositionChange[] = []
  let floor: number | null = null
  for (const row of intended) {
    const rowId = idKey(row)
    if (!rowId) {
      // No addressable id: cannot be synced, so it cannot be repositioned.
      continue
    }
    const current = row.sortOrder
    const usable = isContractPosition(current) && (floor === null || current > floor)
    if (usable) {
      floor = current as number
      continue
    }
    // Raise to just past the running floor (or to 0 to open the list).
    const next: number = floor === null ? 0 : Math.min(floor + 1, PG_INT32_MAX)
    minimal.push({ id: rowId, sortOrder: next })
    floor = next
  }
  if (producesOrder(sorted, minimal, intendedIds)) {
    return minimal
  }

  // Last resort: a dense renumber always realizes the intended order, at the
  // cost of one change per row. Reached only when the minimal sweep cannot
  // (e.g. a run long enough to hit the int32 ceiling).
  return intended.flatMap((row, index) => {
    const rowId = idKey(row)
    if (!rowId) {
      return []
    }
    return row.sortOrder === index ? [] : [{ id: rowId, sortOrder: index }]
  })
}

/** One row's before/after pair, so the caller can queue a sync update. */
export interface RowMoveChange<T> {
  previous: T
  updated: T
}

/** The outcome of a move: the re-sorted collection plus what actually changed. */
export interface RowMoveResult<T> {
  rows: T[]
  changes: RowMoveChange<T>[]
}

/**
 * Execute the plan from {@link planRowMove} against a collection (Story 34.1b).
 *
 * Returns `null` for every no-op — boundary, unknown id, empty/null list — so a
 * caller can `if (!result) return` and leave the store untouched, queueing
 * nothing. Otherwise it returns the canonically re-sorted collection together
 * with a before/after pair per changed row, because `syncEntityUpdate` needs the
 * PRE-edit row to derive its `baseVersion`.
 *
 * ⚠️ `updatedAt` is bumped on every changed row, matching the four update paths.
 * One timestamp is taken for the whole move so the affected rows share it —
 * two `new Date()` calls could straddle a millisecond and make the pair look
 * like two unrelated edits to last-write-wins reconciliation.
 *
 * The four stores each own this behaviour through this one helper rather than
 * four hand-rolled copies: they are four independent implementations with no
 * shared factory, and testing one while assuming the other three is precisely
 * how stories 30-4b and 33.3 each shipped a HIGH.
 */
export function applyRowMove<T extends DisplayOrdered & { updatedAt?: string }>(
  rows: readonly T[] | null,
  id: string,
  direction: RowMoveDirection
): RowMoveResult<T> | null {
  const plan = planRowMove(rows, id, direction)
  if (plan.length === 0) {
    return null
  }
  const timestamp = new Date().toISOString()
  const positionById = new Map(plan.map((change) => [change.id, change.sortOrder]))
  const changes: RowMoveChange<T>[] = []
  const next = (rows ?? []).map((row) => {
    const sortOrder = positionById.get(idKey(row))
    if (sortOrder === undefined) {
      return row
    }
    const updated = { ...row, sortOrder, updatedAt: timestamp }
    changes.push({ previous: row, updated })
    return updated
  })
  return { rows: sortByDisplayOrder(next), changes }
}

export function stampMissingSortOrder<T extends DisplayOrdered>(rows: readonly T[] | null): T[] {
  const sorted = sortByDisplayOrder(rows)
  if (sorted.every((row) => typeof row?.sortOrder === 'number' && Number.isFinite(row.sortOrder))) {
    // Nothing missing — return the sorted array untouched (no needless object churn).
    return sorted
  }
  let next = nextSortOrder(sorted)
  return sorted.map((row) => {
    const value = row?.sortOrder
    if (typeof value === 'number' && Number.isFinite(value)) {
      return row
    }
    const stamped = { ...row, sortOrder: next }
    next += 1
    return stamped
  })
}
