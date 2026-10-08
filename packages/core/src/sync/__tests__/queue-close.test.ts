// Every queue write is a whole-queue write to a key a new service also uses,
// so a closed queue must never write again.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncQueue, SyncQueueClosedError } from '../queue'
import type { SyncOperation, SyncQueueStorage } from '../types'

const USER = 'user-79-1'

type TestStorage = SyncQueueStorage & {
  writes: number
  persistedIds: () => string[]
  holdNextSave: boolean
  releaseSave: () => void
  saveHeld: boolean
}

function createStorage(initial: SyncOperation[] = []): TestStorage {
  let stored: SyncOperation[] | undefined = [...initial]
  let release: () => void = () => {}
  const storage: TestStorage = {
    writes: 0,
    holdNextSave: false,
    saveHeld: false,
    releaseSave: () => release(),
    async loadQueue() {
      return [...(stored ?? [])]
    },
    async saveQueue(_userId, queue) {
      if (storage.holdNextSave) {
        storage.holdNextSave = false
        storage.saveHeld = true
        await new Promise<void>((resolve) => {
          release = resolve
        })
        storage.saveHeld = false
      }
      storage.writes++
      stored = [...queue]
    },
    async clearQueue() {
      storage.writes++
      stored = undefined
    },
    persistedIds: () => (stored ?? []).map((op) => op.id),
  }
  return storage
}

function op(id: string): SyncOperation {
  return {
    id,
    type: 'update',
    entityType: 'incomeSource',
    entityId: `entity-${id}`,
    data: { name: id },
    timestamp: 1_000,
    deviceId: 'device-test',
    userId: USER,
  }
}

const MUTATORS: [string, (queue: SyncQueue) => Promise<unknown>][] = [
  ['add', (q) => q.add(op('c'))],
  ['addBatch', (q) => q.addBatch([op('c'), op('d')])],
  ['remove', (q) => q.remove('a')],
  ['removeBatch', (q) => q.removeBatch(['a'])],
  ['discardBatch', (q) => q.discardBatch(['a'])],
  ['removeByEntity', (q) => q.removeByEntity('incomeSource', 'entity-a')],
  ['clear', (q) => q.clear()],
  ['dequeue', (q) => q.dequeue()],
]

describe('SyncQueue.close() (story 79.1)', () => {
  let storage: TestStorage
  let queue: SyncQueue

  beforeEach(async () => {
    storage = createStorage([op('a'), op('b')])
    queue = new SyncQueue(USER, storage)
    await queue.initialize()
  })

  it.each(MUTATORS)('%s on a CLOSED queue rejects and changes nothing', async (_name, mutate) => {
    queue.close()

    await expect(mutate(queue)).rejects.toBeInstanceOf(SyncQueueClosedError)

    expect(queue.isClosed()).toBe(true)
    expect(storage.writes).toBe(0)
    expect(storage.persistedIds()).toEqual(['a', 'b'])
    expect(queue.getAll().map((o) => o.id)).toEqual(['a', 'b'])
  })

  it.each(MUTATORS)('control: %s on an OPEN queue writes', async (_name, mutate) => {
    await mutate(queue)

    expect(queue.isClosed()).toBe(false)
    expect(storage.writes).toBe(1)
  })

  it('refuses a mutation that was called BEFORE close() but had not run yet', async () => {
    storage.holdNextSave = true
    const first = queue.add(op('c'))
    const second = queue.removeBatch(['a'])
    // The chain starts work on a microtask, so wait until the write is really held.
    await vi.waitFor(() => expect(storage.saveHeld).toBe(true))

    queue.close()
    storage.releaseSave()

    // Already inside `saveQueue` when closed, so it completes.
    await expect(first).resolves.toBeUndefined()
    await expect(second).rejects.toBeInstanceOf(SyncQueueClosedError)
    expect(storage.writes).toBe(1)
    expect(storage.persistedIds()).toEqual(['a', 'b', 'c'])
    expect(queue.getAll().map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('initialize() on a closed queue resolves without loading', async () => {
    const fresh = new SyncQueue(USER, storage)
    fresh.close()

    await expect(fresh.initialize()).resolves.toBeUndefined()

    expect(fresh.getAll()).toEqual([])
    const open = new SyncQueue(USER, storage)
    await open.initialize()
    expect(open.getAll().map((o) => o.id)).toEqual(['a', 'b'])
  })

  it('readers keep working on the frozen memory', () => {
    queue.close()

    expect(queue.getCount()).toBe(2)
    expect(queue.hasPendingOperations('incomeSource', 'entity-a')).toBe(true)
    expect(queue.getReadyOperations().map((o) => o.id)).toEqual(['a', 'b'])
  })
})
