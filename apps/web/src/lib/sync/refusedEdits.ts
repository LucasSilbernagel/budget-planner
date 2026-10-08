/**
 * Refused edits are reverted: a created row via a synthetic tombstone, an update/delete via a full re-pull.
 * Never through a store action, which would queue a delete for a row the server never had (a permanent conflict).
 */

import type { ServerChange, SyncEntityType, SyncOperation } from '@budget-planner/core/sync'
import type { RefusalNotice, RefusalOutcome } from './refusalNoticeStore'

export interface RefusalHandlerDeps {
  queue: {
    getAll: () => SyncOperation[]
    discardBatch: (ids: string[]) => Promise<{ removed: number; persisted: boolean }>
  }
  discardOperationsForDeletedProfile: (profileId: string) => Promise<unknown>
  applyChanges: (changes: ServerChange[]) => void
  lookupLocalRow: (entityType: SyncEntityType, id: string) => Record<string, unknown> | undefined
  requestFullRepull: () => void
  notify: (notices: RefusalNotice[]) => void
  markPlanRefused?: (op: SyncOperation) => void
}

const KIND: Record<SyncEntityType, { kind: string; fallback: string }> = {
  incomeSource: { kind: 'income', fallback: 'An income entry' },
  expense: { kind: 'expense', fallback: 'An expense' },
  savingsGoal: { kind: 'savings', fallback: 'A savings entry' },
  balanceTracking: { kind: 'balance', fallback: 'A balance entry' },
  userProfile: { kind: 'profile', fallback: 'A profile' },
  category: { kind: 'category', fallback: 'A category' },
  // A plan op carries no `name`, so the notice uses the fallback.
  retirementPlan: { kind: 'retirement plan', fallback: 'Your retirement plan' },
}

const BALANCE_KIND: Record<string, { kind: string; fallback: string }> = {
  investment: { kind: 'investment', fallback: 'An investment' },
  debt: { kind: 'debt', fallback: 'A debt' },
}

function nonBlankString(value: unknown): string | null {
  // Whitespace-only counts as absent: pulled names aren't form-validated.
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

type RowIdentity = Pick<RefusalNotice, 'key' | 'entityType' | 'name' | 'kind' | 'fallback'>

function identifyRow(
  ops: readonly SyncOperation[],
  localRow: Record<string, unknown> | undefined
): RowIdentity {
  const first = ops[0] as SyncOperation
  const newestFirst = [...ops].sort((a, b) => b.timestamp - a.timestamp)

  let name: string | null = null
  for (const op of newestFirst) {
    name = nonBlankString(op.data?.['name'])
    if (name) break
  }
  // A delete carries only `{ userId }`; fall back to the local row.
  name ??= nonBlankString(localRow?.['name'])

  let label = KIND[first.entityType] ?? { kind: 'entry', fallback: 'An entry' }
  if (first.entityType === 'balanceTracking') {
    const type = newestFirst.map((op) => op.data?.['type']).find((t) => typeof t === 'string')
    const balanceType = typeof type === 'string' ? type : localRow?.['type']
    if (typeof balanceType === 'string' && BALANCE_KIND[balanceType]) {
      label = BALANCE_KIND[balanceType]
    }
  }

  return {
    key: `${first.entityType}:${first.entityId}`,
    entityType: first.entityType,
    name,
    kind: label.kind,
    fallback: label.fallback,
  }
}

export function describeRefusedRow(
  ops: readonly SyncOperation[],
  localRow: Record<string, unknown> | undefined
): RefusalNotice {
  let outcome: RefusalOutcome = 'changed-back'
  if (ops.some((op) => op.type === 'create')) {
    outcome = 'removed'
  } else if (ops.some((op) => op.type === 'delete')) {
    outcome = 'restored'
  }
  return { ...identifyRow(ops, localRow), outcome }
}

/** A delete wins over a create: a created-then-deleted row is gone, so "saved on this device" would be false. */
export function describeNotSyncedRow(
  ops: readonly SyncOperation[],
  localRow: Record<string, unknown> | undefined
): RefusalNotice {
  let change: RefusalNotice['change'] = 'update'
  if (ops.some((op) => op.type === 'delete')) {
    change = 'delete'
  } else if (ops.some((op) => op.type === 'create')) {
    change = 'create'
  }
  return { ...identifyRow(ops, localRow), outcome: 'not-synced', change }
}

export function describeNotSyncedRows(
  ops: readonly SyncOperation[],
  lookupLocalRow: RefusalHandlerDeps['lookupLocalRow']
): RefusalNotice[] {
  const byRow = new Map<string, SyncOperation[]>()
  for (const op of ops) {
    const key = `${op.entityType}:${op.entityId}`
    const list = byRow.get(key)
    if (list) list.push(op)
    else byRow.set(key, [op])
  }
  return [...byRow.values()].map((rowOps) => {
    const first = rowOps[0] as SyncOperation
    try {
      return describeNotSyncedRow(rowOps, lookupLocalRow(first.entityType, first.entityId))
    } catch (error) {
      console.error('[refusedEdits] could not read a not-synced row; naming it generically:', error)
      return describeNotSyncedRow(rowOps, undefined)
    }
  })
}

/** One row's failed naming or revert must not stop the others, the re-pull or the notices. */
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

  // Name every row before reverting: a tombstone removes the row a name is read from.
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
    // A refused plan edit keeps the local plan (a re-pull would overwrite it with an older copy);
    // the marker makes the applier skip the plan until a push succeeds.
    if (first.entityType === 'retirementPlan') {
      try {
        // The NEWEST refused op for the plan: an older one must not outrank an
        // update the server accepted after it.
        const newest = rowOps.reduce((a, b) => (b.timestamp > a.timestamp ? b : a))
        deps.markPlanRefused?.(newest)
      } catch (error) {
        console.error('[refusedEdits] could not mark the retirement plan as not synced:', error)
      }
      continue
    }
    if (notice.outcome !== 'removed') {
      needsRepull = true
      continue
    }
    // Drop any op for the row still queued; left queued it gets `update-delete`, a conflict never removed.
    const leftover = deps.queue
      .getAll()
      .filter((op) => op.entityType === first.entityType && op.entityId === first.entityId)
      .map((op) => op.id)
    if (leftover.length > 0) {
      // discardBatch, not removeBatch: removeBatch keeps the ops queued if storage refuses the write.
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
