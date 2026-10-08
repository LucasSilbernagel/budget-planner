// Store writes call `add` without awaiting it, so N un-awaited adds must yield
// N queued operations, in call order, in memory and persisted.

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

/** `saveQueue` awaits before writing; that await is the window in which adds interleave. */
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
    const first = queue.add(makeOperation('A'))
    const second = queue.add(makeOperation('B'))
    await Promise.all([first, second])

    expect(queue.getAll().map((operation) => operation.id)).toEqual(['A', 'B'])
  })

  it('persists both operations, not just the last one', async () => {
    void queue.add(makeOperation('A'))
    void queue.add(makeOperation('B'))
    await new Promise((resolve) => setTimeout(resolve, 0))

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

  // A throwing `clearQueue` must not leave memory empty while the ops remain on disk.
  it('keeps the in-memory queue when clearing storage fails', async () => {
    const failing: SyncQueueStorage = {
      async loadQueue() {
        return []
      },
      async saveQueue() {},
      async clearQueue() {
        throw new Error('storage unavailable')
      },
    }
    const q = new SyncQueue('user-3', failing)
    await q.initialize()
    await q.add(makeOperation('A'))
    await q.add(makeOperation('B'))

    await expect(q.clear()).rejects.toThrow('storage unavailable')

    expect(q.getAll().map((operation) => operation.id)).toEqual(['A', 'B'])
  })

  it('still rejects an add once the queue is full, counting interleaved adds', async () => {
    // The size guard reads `this.queue.length`; unserialized adds all saw a stale length.
    const full = new SyncQueue('user-2', createRecordingStorage())
    await full.initialize()
    await Promise.all(
      Array.from({ length: 10_000 }, (_unused, index) => full.add(makeOperation(`op-${index}`)))
    )

    expect(full.getAll()).toHaveLength(10_000)
    await expect(full.add(makeOperation('overflow'))).rejects.toThrow(/Queue size limit/)
  })
})
