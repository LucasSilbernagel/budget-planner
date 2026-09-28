/**
 * What this device does when the server PERMANENTLY refuses a sync edit
 * (story 75.2, FR119).
 *
 * Core removes a refused op from the queue (story 75.1) and reports it through
 * `onOperationsRejected`; `useSync` hands the ops here. Two things happen per
 * refused ROW:
 *
 *   1. The user is told, by name (`refusalNoticeStore`).
 *   2. The change is REVERTED on this device. DECISION (Lucas, 2026-09-28).
 *
 * Why revert, from the trace recorded in the story:
 *   - A refused CREATE's row exists only here. Left in place, its next edit
 *     queues an `update` that the server answers `update-delete` — a CONFLICT,
 *     which core never removes — so the account-wide deadlock 75.1 broke comes
 *     straight back. The row has to go.
 *   - A refused UPDATE leaves this device holding a value no other device has,
 *     and `toServerPayload` sends the FULL row on every later edit, so the bad
 *     field would be refused again with every rename. The pre-edit value is not
 *     on this device at all (the op carries only the new values); only the
 *     server has it, so the revert is a full re-pull.
 *   - A refused DELETE: the server still has the row live, so the same re-pull
 *     brings it back.
 *
 * ⚠️⚠️ The revert NEVER goes through a store action (`removeSavingsGoal`, …).
 * Store actions call the sync bridge, which would QUEUE A DELETE for a row the
 * server never had: `delete-update`, a conflict that is never removed, and the
 * deadlock returns. A created row is removed with a synthetic TOMBSTONE through
 * the pull applier, which writes the stores directly — the same path a pulled
 * delete takes, so a profile tombstone also cascades its rows and repoints the
 * active profile.
 *
 * ⚠️ A refused PROFILE create: its local child rows go with it (the tombstone
 * cascade), and so do their own queued ops (story 76.2), through core's
 * `discardOperationsForDeletedProfile` — the same strict predicate a pulled
 * profile tombstone uses. Left queued they would fail `Profile not found` for
 * ever, which is deliberately not permanent on the server (75.1): a refused
 * create is the positive proof the server cannot see.
 */

import type { ServerChange, SyncEntityType, SyncOperation } from '@budget-planner/core/sync'
import type { RefusalNotice, RefusalOutcome } from './refusalNoticeStore'

/** Everything the handler touches, injected so it can be tested on its own. */
export interface RefusalHandlerDeps {
  /** The live sync queue (core `SyncQueue`). */
  queue: {
    getAll: () => SyncOperation[]
    discardBatch: (ids: string[]) => Promise<{ removed: number; persisted: boolean }>
  }
  /**
   * Core's `discardOperationsForDeletedProfile` (story 76.2): drop the queued ops
   * stamped with a profile whose create the server refused.
   */
  discardOperationsForDeletedProfile: (profileId: string) => Promise<unknown>
  /** `applyServerChangesToStores` — used to apply the synthetic tombstones. */
  applyChanges: (changes: ServerChange[]) => void
  /** `findLocalRow` — reads a row's current local state, for its name and kind. */
  lookupLocalRow: (entityType: SyncEntityType, id: string) => Record<string, unknown> | undefined
  /** Reset the pull cursor and pull a full snapshot (honouring an in-flight pull). */
  requestFullRepull: () => void
  /** `addRefusalNotices`. */
  notify: (notices: RefusalNotice[]) => void
}

const KIND: Record<SyncEntityType, { kind: string; fallback: string }> = {
  incomeSource: { kind: 'income', fallback: 'An income entry' },
  expense: { kind: 'expense', fallback: 'An expense' },
  savingsGoal: { kind: 'savings', fallback: 'A savings entry' },
  balanceTracking: { kind: 'balance', fallback: 'A balance entry' },
  userProfile: { kind: 'profile', fallback: 'A profile' },
  category: { kind: 'category', fallback: 'A category' },
}

/** `balanceTracking` rows are an investment or a debt; say which when we know. */
const BALANCE_KIND: Record<string, { kind: string; fallback: string }> = {
  investment: { kind: 'investment', fallback: 'An investment' },
  debt: { kind: 'debt', fallback: 'A debt' },
}

function nonBlankString(value: unknown): string | null {
  // ⚠️ Whitespace-only counts as ABSENT — story 63.2's review deferred exactly
  // this: a pulled whitespace name rendered `aria-label="Delete "`. Pulled names
  // are not form-validated.
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Name, kind and outcome for one refused row. `ops` are every refused op for
 * that row (a refused create arrives with its follow-ups, 75.1 D1); `localRow`
 * is the row as this device holds it BEFORE any revert.
 */
export function describeRefusedRow(
  ops: readonly SyncOperation[],
  localRow: Record<string, unknown> | undefined
): RefusalNotice {
  const first = ops[0] as SyncOperation
  const newestFirst = [...ops].sort((a, b) => b.timestamp - a.timestamp)

  let name: string | null = null
  for (const op of newestFirst) {
    name = nonBlankString(op.data?.['name'])
    if (name) break
  }
  // A delete carries only `{ userId }`; fall back to the local row. For a
  // refused delete the row is usually gone already, so this is often null too.
  name ??= nonBlankString(localRow?.['name'])

  let label = KIND[first.entityType] ?? { kind: 'entry', fallback: 'An entry' }
  if (first.entityType === 'balanceTracking') {
    const type = newestFirst.map((op) => op.data?.['type']).find((t) => typeof t === 'string')
    const balanceType = typeof type === 'string' ? type : localRow?.['type']
    if (typeof balanceType === 'string' && BALANCE_KIND[balanceType]) {
      label = BALANCE_KIND[balanceType]
    }
  }

  let outcome: RefusalOutcome = 'changed-back'
  if (ops.some((op) => op.type === 'create')) {
    outcome = 'removed'
  } else if (ops.some((op) => op.type === 'delete')) {
    outcome = 'restored'
  }

  return {
    key: `${first.entityType}:${first.entityId}`,
    entityType: first.entityType,
    name,
    kind: label.kind,
    fallback: label.fallback,
    outcome,
  }
}

/**
 * Tell the user about, and revert, every row in one sync's refused ops.
 *
 * Each row's naming and revert are isolated (code review 75.2): a row whose
 * name cannot be read gets a fallback notice, and one row's failed revert does
 * not stop the others, the re-pull or the notices.
 */
export async function handleRejectedOperations(
  ops: readonly SyncOperation[],
  deps: RefusalHandlerDeps
): Promise<void> {
  const byRow = new Map<string, SyncOperation[]>()
  for (const op of ops) {
    const key = `${op.entityType}:${op.entityId}`
    const list = byRow.get(key)
    if (list) list.push(op)
    else byRow.set(key, [op])
  }

  // Name every row BEFORE reverting anything: a tombstone removes the local row
  // a name may have to be read from.
  const notices = [...byRow.values()].map((rowOps) => {
    const first = rowOps[0] as SyncOperation
    try {
      return describeRefusedRow(rowOps, deps.lookupLocalRow(first.entityType, first.entityId))
    } catch (error) {
      console.error('[refusedEdits] could not read a refused row; naming it generically:', error)
      return describeRefusedRow(rowOps, undefined)
    }
  })

  let needsRepull = false
  for (const notice of notices) {
    const rowOps = byRow.get(notice.key) as SyncOperation[]
    const first = rowOps[0] as SyncOperation
    if (notice.outcome !== 'removed') {
      // One full re-pull covers every refused update and delete in this sync.
      needsRepull = true
      continue
    }
    // A refused CREATE. First drop any op for the row that is STILL queued —
    // one queued after 75.1's D1 swept the queue (an edit made while the push
    // was in flight). Left queued, it gets `update-delete`: a conflict, never
    // removed.
    const leftover = deps.queue
      .getAll()
      .filter((op) => op.entityType === first.entityType && op.entityId === first.entityId)
      .map((op) => op.id)
    if (leftover.length > 0) {
      // `discardBatch`, not `removeBatch` (story 75.3). If storage refuses the
      // write, `removeBatch` keeps them queued, and they become that very
      // never-removed conflict. `discardBatch` drops them from this session
      // regardless. Storage keeps them until its next successful write, so a
      // reload before then brings them back.
      try {
        const { persisted } = await deps.queue.discardBatch(leftover)
        console.info(
          `[refusedEdits] dropped ${leftover.length} op(s) still queued for a refused create (${notice.key})`
        )
        if (!persisted) {
          console.warn(
            `[refusedEdits] storage refused the write, so the drop holds for this session only (${notice.key})`
          )
        }
      } catch (error) {
        console.error('[refusedEdits] could not drop queued ops for a refused create:', error)
      }
    }
    try {
      deps.applyChanges([
        {
          entityType: first.entityType,
          entityId: first.entityId,
          data: {},
          updatedAt: Date.now(),
          isDeleted: true,
        },
      ])
    } catch (error) {
      console.error('[refusedEdits] could not remove a refused create locally:', error)
    }
    if (first.entityType === 'userProfile') {
      try {
        await deps.discardOperationsForDeletedProfile(first.entityId)
      } catch (error) {
        console.error('[refusedEdits] could not drop queued ops of a refused profile:', error)
      }
    }
  }

  if (needsRepull) {
    try {
      deps.requestFullRepull()
    } catch (error) {
      console.error('[refusedEdits] could not request the revert re-pull:', error)
    }
  }
  deps.notify(notices)
}
