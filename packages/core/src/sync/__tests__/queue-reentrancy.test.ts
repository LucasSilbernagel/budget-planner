/**
 * Sync queue re-entrancy (story 34.1b, AC-3)
 *
 * `SyncQueue.add` persists BEFORE mutating in-memory state, which means it
 * reads `this.queue`, awaits `saveQueue`, and only then assigns. Callers that
 * do not await it therefore interleave: the second call reads the queue as it
 * was before the first call finished, and its write clobbers the first
 * operation.
 *
 * This is not hypothetical. `syncEntityUpdate` (apps/web) returns `void` and
 * only attaches `.catch()`, so EVERY store write is an un-awaited add. A
 * story-34.1b reorder swaps two rows and therefore enqueues twice in one
 * synchronous turn; `useCategoryManager` already loops N un-awaited updates to
 * clear a deleted category.
 *
 * These tests pin the property the callers actually need: N un-awaited adds
 * yield N queued operations, in call order, both in memory and persisted.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { SyncQueue } from '../queue'
import type { SyncOperation, SyncQueueStorage } from '../types'

function makeOperation(id: string): SyncOperation {
  return {
    id,
    type: 'update',
    entityType: 'incomeSource',
    entityId: `entity-${id}`,
    data: { name: id },
    timestamp: 1_000,
    retryCount: 0,
    userId: 'user-1',
  } as unknown as SyncOperation
}

/**
 * Storage that records every save. `saveQueue` is genuinely async (it awaits a
 * resolved promise before writing), matching the real localStorage
 * implementation's `async` signature — that await is the window in which the
 * interleaving happens.
 */
function createRecordingStorage(): SyncQueueStorage & { saves: SyncOperation[][] } {
  const saves: SyncOperation[][] = []
  return {
    saves,
    async loadQueue() {
      return []
    },
    async saveQueue(_userId: string, queue: SyncOperation[]) {
      await Promise.resolve()
      saves.push([...queue])
    },
    async clearQueue() {
      saves.push([])
    },
  }
}

describe('SyncQueue re-entrancy (34.1b AC-3)', () => {
  let storage: ReturnType<typeof createRecordingStorage>
  let queue: SyncQueue

  beforeEach(async () => {
    storage = createRecordingStorage()
    queue = new SyncQueue('user-1', storage)
    await queue.initialize()
  })

  it('keeps BOTH operations when two adds are not awaited (the reorder swap)', async () => {
    // Exactly what a row swap does: two store writes in one synchronous turn,
    // neither awaited, because syncEntityUpdate returns void.
    const first = queue.add(makeOperation('A'))
    const second = queue.add(makeOperation('B'))
    await Promise.all([first, second])

    expect(queue.getAll().map((operation) => operation.id)).toEqual(['A', 'B'])
  })

  it('persists both operations, not just the last one', async () => {
    void queue.add(makeOperation('A'))
    void queue.add(makeOperation('B'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The LAST save is what survives a reload. If the adds interleaved, it
    // holds only ['B'] and operation A is unrecoverable.
    expect(storage.saves.at(-1)?.map((operation) => operation.id)).toEqual(['A', 'B'])
  })

  it('preserves call order across N un-awaited adds (the category cascade)', async () => {
    const ids = ['A', 'B', 'C', 'D', 'E']
    await Promise.all(ids.map((id) => queue.add(makeOperation(id))))

    expect(queue.getAll().map((operation) => operation.id)).toEqual(ids)
  })

  it('serializes addBatch against add without losing either', async () => {
    void queue.add(makeOperation('A'))
    void queue.addBatch([makeOperation('B'), makeOperation('C')])
    void queue.add(makeOperation('D'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(queue.getAll().map((operation) => operation.id)).toEqual(['A', 'B', 'C', 'D'])
    expect(storage.saves.at(-1)?.map((operation) => operation.id)).toEqual(['A', 'B', 'C', 'D'])
  })

  /**
   * Persist-before-mutate, for `clear()` specifically (code review).
   *
   * Every other mutator writes storage first so a storage failure cannot leave
   * memory and disk disagreeing. `clear()` used to empty memory FIRST, so a
   * throwing `clearQueue` left memory saying "empty" while the operations were
   * still on disk — and they came back on the next reload.
   */
  it('keeps the in-memory queue when clearing storage fails', async () => {
    const failing: SyncQueueStorage = {
      async loadQueue() {
        return []
      },
      async saveQueue() {
        // no-op: adds must succeed so there is something to lose
      },
      async clearQueue() {
        throw new Error('storage unavailable')
      },
    }
    const q = new SyncQueue('user-3', failing)
    await q.initialize()
    await q.add(makeOperation('A'))
    await q.add(makeOperation('B'))

    await expect(q.clear()).rejects.toThrow('storage unavailable')

    // Memory must still agree with what is persisted — i.e. nothing was lost.
    expect(q.getAll().map((operation) => operation.id)).toEqual(['A', 'B'])
  })

  it('still rejects an add once the queue is full, counting interleaved adds', async () => {
    // The size guard reads `this.queue.length`. Before serialization a burst of
    // un-awaited adds all saw the same stale length, so the guard undercounted.
    const full = new SyncQueue('user-2', createRecordingStorage())
    await full.initialize()
    await Promise.all(
      Array.from({ length: 10_000 }, (_unused, index) => full.add(makeOperation(`op-${index}`)))
    )

    expect(full.getAll()).toHaveLength(10_000)
    await expect(full.add(makeOperation('overflow'))).rejects.toThrow(/Queue size limit/)
  })
})
