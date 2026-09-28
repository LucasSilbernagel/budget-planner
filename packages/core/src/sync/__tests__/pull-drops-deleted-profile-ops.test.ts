/**
 * A profile deleted on another device no longer strands this device's queue
 * (story 76.2, FR121).
 *
 * ## The defect this closes
 *
 * Device A deletes profile P, and the server cascade tombstones P's rows. Device
 * B still holds queued ops stamped `profileId === P`. The server answers them for
 * ever: a child `create` fails `Profile not found` with no permanent status (kept
 * queued), and a child `update` of a cascade-tombstoned row is an `update-delete`
 * CONFLICT (never removed). MEASURED at `145cb27` with a two-device PGlite probe:
 * both survived B's pull and every later push. B's pull DID deliver P's
 * tombstone (profiles are pulled by user, tombstones included), but the child
 * rows are pulled only for the ACTIVE profile and a child create never reached
 * the server, so last-writer-wins never saw those ops.
 *
 * Now an APPLIED profile tombstone takes those ops with it, in the same pull.
 *
 * ## The pair (decision D1 = A, Lucas 2026-09-28)
 *
 * `removeProfile` queues `delete X` then a promotion of the survivor Y. When
 * the pull drops `delete X` by LWW (X was edited elsewhere, so the deletion lost),
 * the promotion is dropped too: it names the delete in `dependsOn`. The reverse
 * is deliberately NOT true: a lost promotion leaves the delete queued, because
 * the delete is the user's intent and the promotion only its consequence.
 *
 * ⚠️ Every "was dropped" assertion reads the QUEUE first. That observable exists
 * on `main`, so the RED output names the ops still queued, not a missing field.
 */

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncQueue } from '../queue'
import { SynchronizationService } from '../synchronization'
import type { ServerChange, SyncOperation, SyncQueueStorage, SyncState } from '../types'

const USER = '11111111-1111-4111-8111-111111111111'
const P = '22222222-2222-4222-8222-222222222222'
const Q = '33333333-3333-4333-8333-333333333333'
const X = '44444444-4444-4444-8444-444444444444'
const Y = '55555555-5555-4555-8555-555555555555'
const ROW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ISO = '2026-09-01T00:00:00.000Z'

type Internals = { queue: SyncQueue; state: SyncState }
const internals = (service: SynchronizationService) => service as unknown as Internals

function createStorage(): SyncQueueStorage & { persistedIds: () => string[] } {
  const stored = new Map<string, SyncOperation[]>()
  return {
    async loadQueue(userId) {
      return [...(stored.get(userId) ?? [])]
    },
    async saveQueue(userId, queue) {
      stored.set(userId, [...queue])
    },
    async clearQueue(userId) {
      stored.delete(userId)
    },
    persistedIds: () => (stored.get(USER) ?? []).map((op) => op.id),
  }
}

function op(id: string, overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id,
    type: 'update',
    entityType: 'incomeSource',
    entityId: ROW,
    data: { name: 'Salary' },
    timestamp: 1_000,
    deviceId: 'device-b',
    userId: USER,
    ...overrides,
  }
}

/** A production-shaped pulled profile row (every field valid for core's schema). */
function profileChange(
  id: string,
  { isDeleted = false, isDefault = false, updatedAt = 2_000 } = {}
): ServerChange {
  return {
    entityType: 'userProfile',
    entityId: id,
    data: {
      id,
      userId: USER,
      name: `Profile ${id.slice(0, 4)}`,
      description: null,
      isDefault,
      currency: 'NONE',
      icon: null,
      isDeleted,
      createdAt: ISO,
      updatedAt: ISO,
    },
    updatedAt,
    isDeleted,
  }
}

describe('pull() lets go of a remotely deleted profile’s queued ops (story 76.2)', () => {
  let storage: ReturnType<typeof createStorage>
  let queue: SyncQueue
  let service: SynchronizationService
  let fetchServerChanges: Mock<[since: number | null], Promise<ServerChange[]>>
  let processOperation: Mock
  let queueSeenByPulledCallback: string[][]

  const queuedIds = (): string[] => queue.getAll().map((o) => o.id)

  beforeEach(async () => {
    vi.useFakeTimers()
    storage = createStorage()
    fetchServerChanges = vi.fn(async (_since: number | null) => [] as ServerChange[])
    // The server's real answers for a stranded op (MEASURED at 145cb27): a
    // child create fails with no permanent status, so it would stay queued.
    processOperation = vi.fn(async () => ({ success: false, retryable: false }))
    service = new SynchronizationService(USER, {
      autoSync: false,
      processOperation,
      fetchServerChanges,
    })
    queue = new SyncQueue(USER, storage)
    await queue.initialize()
    internals(service).queue = queue
    internals(service).state.isOnline = true
    queueSeenByPulledCallback = []
    service.onChangesPulled(() => queueSeenByPulledCallback.push(queuedIds()))
  })

  afterEach(() => {
    service.destroy()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('AC-1/AC-3: an APPLIED profile tombstone', () => {
    it('drops the queued child ops stamped with that profile, in the same pull, before onChangesPulled', async () => {
      await queue.add(op('child-create', { type: 'create', profileId: P, entityId: ROW }))
      await queue.add(op('child-update', { profileId: P, baseVersion: 500 }))
      await queue.add(
        op('child-category', { entityType: 'category', entityId: X, profileId: P, timestamp: 900 })
      )
      fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])

      const result = await service.pull()

      // RED at 145cb27: all three stay queued.
      expect(queuedIds()).toEqual([])
      expect(storage.persistedIds()).toEqual([])
      // Positive anchor: the tombstone was applied by this pull.
      expect(result.applied.map((c) => [c.entityId, c.isDeleted])).toEqual([[P, true]])
      // The same pass: already gone when the web layer hears about the pull.
      expect(queueSeenByPulledCallback).toEqual([[]])
      // Reported, and NOT as a conflict: these ops lost no comparison.
      expect(result.discardedForDeletedProfile.map((o) => o.id).sort()).toEqual([
        'child-category',
        'child-create',
        'child-update',
      ])
      expect(service.getState().conflictOperations).toEqual([])
      expect(service.getState().pendingOperations).toEqual([])
    })

    it('a later push sends none of them, so the failure count does not climb', async () => {
      await queue.add(op('child-create', { type: 'create', profileId: P }))
      fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])
      // Control: before the pull, a push DOES send the stranded op and it fails.
      await service.sync()
      expect(processOperation).toHaveBeenCalledTimes(1)
      const failuresAfterControl = (service as unknown as { consecutiveFailures: number })
        .consecutiveFailures
      expect(failuresAfterControl).toBeGreaterThan(0)

      await service.pull()
      await service.sync()

      expect(processOperation).toHaveBeenCalledTimes(1)
      expect(
        (service as unknown as { consecutiveFailures: number }).consecutiveFailures
      ).toBeLessThanOrEqual(failuresAfterControl)
    })

    it('a queued edit of the deleted profile ITSELF is drained by the same pull (LWW: the tombstone is newer than its baseVersion)', async () => {
      // The 76.1 deferral: an UPDATE of a profile deleted elsewhere is answered
      // `update-delete` on every push. It needs no new code: last-writer-wins
      // drops it, because the tombstone's `updatedAt` beats the op's base.
      await queue.add(
        op('rename-P', {
          entityType: 'userProfile',
          entityId: P,
          data: { name: 'P renamed' },
          baseVersion: 1_000,
        })
      )
      fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])

      const result = await service.pull()

      expect(queuedIds()).toEqual([])
      // Dropped by LWW (a conflict), not by the stranded sweep.
      expect(service.getState().conflictOperations.map((o) => o.id)).toEqual(['rename-P'])
      expect(result.discardedForDeletedProfile).toEqual([])
    })
  })

  describe('AC-2: the predicate is strict', () => {
    it('keeps ops for another profile, an unstamped op, and every userProfile op for another profile', async () => {
      await queue.add(op('child-in-P', { profileId: P }))
      await queue.add(op('child-in-Q', { profileId: Q, entityId: X }))
      await queue.add(op('child-unstamped', { entityId: Y }))
      // ⚠️ THE TRAP. `op.profileId` is the ACTIVE-profile stamp. Deleting the
      // ACTIVE default queues the survivor's promotion before the stamp moves, so
      // it carries the DELETED profile's id. So does a profile created while P
      // was active.
      await queue.add(
        op('promote-Y', {
          entityType: 'userProfile',
          entityId: Y,
          profileId: P,
          data: { isDefault: true },
          baseVersion: 1_500,
        })
      )
      await queue.add(
        op('create-Q', { type: 'create', entityType: 'userProfile', entityId: Q, profileId: P })
      )
      fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])

      const result = await service.pull()

      expect(queuedIds()).toEqual(['child-in-Q', 'child-unstamped', 'promote-Y', 'create-Q'])
      expect(result.discardedForDeletedProfile.map((o) => o.id)).toEqual(['child-in-P'])
    })

    it('drops nothing when the tombstone is SUPPRESSED by a winning local edit of that profile', async () => {
      // A local edit of P with no baseVersion, newer than the tombstone: local
      // wins, the tombstone is NOT applied, and P is still live on this device.
      await queue.add(
        op('rename-P', {
          entityType: 'userProfile',
          entityId: P,
          profileId: Q,
          data: { name: 'P renamed' },
          timestamp: 3_000,
        })
      )
      await queue.add(op('child-in-P', { profileId: P }))
      fetchServerChanges.mockResolvedValueOnce([profileChange(P, { isDeleted: true })])

      const result = await service.pull()

      // Positive anchor: the tombstone was delivered and lost LWW.
      expect(result.conflicts.map((c) => c.entityId)).toEqual([P])
      expect(result.applied).toEqual([])
      expect(queuedIds()).toEqual(['rename-P', 'child-in-P'])
      expect(result.discardedForDeletedProfile).toEqual([])
    })

    it('drops nothing for a LIVE profile change', async () => {
      await queue.add(op('child-in-P', { profileId: P }))
      fetchServerChanges.mockResolvedValueOnce([profileChange(P)])

      const result = await service.pull()

      expect(result.applied.map((c) => c.entityId)).toEqual([P])
      expect(queuedIds()).toEqual(['child-in-P'])
    })
  })

  describe('AC-4: the delete + promotion pair (D1 = A, one-way)', () => {
    const deleteX = () =>
      op('delete-X', {
        type: 'delete',
        entityType: 'userProfile',
        entityId: X,
        data: {},
        profileId: X,
        baseVersion: 1_000,
      })
    const promoteY = (withLink: boolean) =>
      op('promote-Y', {
        entityType: 'userProfile',
        entityId: Y,
        profileId: X,
        data: { isDefault: true },
        baseVersion: 1_000,
        ...(withLink
          ? {
              dependsOn: {
                entityType: 'userProfile' as const,
                entityId: X,
                type: 'delete' as const,
              },
            }
          : {}),
      })

    it('a delete that LOSES LWW takes its promotion with it', async () => {
      await queue.add(deleteX())
      await queue.add(promoteY(true))
      // X was edited elsewhere after this device last saw it: the server wins.
      fetchServerChanges.mockResolvedValueOnce([profileChange(X, { isDefault: true })])

      const result = await service.pull()

      // RED at 145cb27: the promotion stays queued, so the default moves on push.
      expect(queuedIds()).toEqual([])
      expect(result.droppedDependents.map((o) => o.id)).toEqual(['promote-Y'])
      // The delete lost a comparison and is a conflict, as before. The promotion
      // lost nothing: it is reported as a dependent, not as a conflict.
      expect(service.getState().conflictOperations.map((o) => o.id)).toEqual(['delete-X'])
      expect(queueSeenByPulledCallback).toEqual([[]])
    })

    it('a delete dropped by LWW against a TOMBSTONE keeps its promotion: the deletion HAPPENED', async () => {
      // Another device deleted X first (or this device's own push landed and its
      // response was lost). The queued delete is dropped because the server is
      // newer, but the target state holds, so the promotion still makes sense.
      await queue.add(deleteX())
      await queue.add(promoteY(true))
      fetchServerChanges.mockResolvedValueOnce([profileChange(X, { isDeleted: true })])

      const result = await service.pull()

      expect(queuedIds()).toEqual(['promote-Y'])
      expect(result.droppedDependents).toEqual([])
    })

    it('a promotion that LOSES LWW leaves the delete queued (one-way)', async () => {
      await queue.add(deleteX())
      await queue.add(promoteY(true))
      fetchServerChanges.mockResolvedValueOnce([profileChange(Y)])

      const result = await service.pull()

      expect(queuedIds()).toEqual(['delete-X'])
      expect(result.droppedDependents).toEqual([])
    })

    it('a promotion queued before this story (no dependsOn) behaves exactly as before', async () => {
      await queue.add(deleteX())
      await queue.add(promoteY(false))
      fetchServerChanges.mockResolvedValueOnce([profileChange(X, { isDefault: true })])

      const result = await service.pull()

      expect(queuedIds()).toEqual(['promote-Y'])
      expect(result.droppedDependents).toEqual([])
    })

    it('a dependent is dropped only when the op it names was dropped, not a different op on that row', async () => {
      // An UPDATE of X (not its delete) loses LWW. The promotion names X's
      // DELETE, which was never queued, so it stays.
      await queue.add(
        op('rename-X', { entityType: 'userProfile', entityId: X, data: {}, baseVersion: 1_000 })
      )
      await queue.add(promoteY(true))
      fetchServerChanges.mockResolvedValueOnce([profileChange(X)])

      const result = await service.pull()

      expect(queuedIds()).toEqual(['promote-Y'])
      expect(result.droppedDependents).toEqual([])
    })
  })

  describe('AC-6: the public entry point', () => {
    it('discardOperationsForDeletedProfile applies the same strict predicate', async () => {
      await queue.add(op('child-in-P', { profileId: P }))
      await queue.add(op('child-in-Q', { profileId: Q, entityId: X }))
      await queue.add(op('promote-Y', { entityType: 'userProfile', entityId: Y, profileId: P }))

      const dropped = await service.discardOperationsForDeletedProfile(P)

      expect(queuedIds()).toEqual(['child-in-Q', 'promote-Y'])
      expect(dropped.map((o) => o.id)).toEqual(['child-in-P'])
      expect(storage.persistedIds()).toEqual(['child-in-Q', 'promote-Y'])
      expect(service.getState().pendingOperations.map((o) => o.id)).toEqual([
        'child-in-Q',
        'promote-Y',
      ])
    })

    it('is a no-op for an empty id', async () => {
      await queue.add(op('unstamped', { profileId: '' }))
      expect(await service.discardOperationsForDeletedProfile('')).toEqual([])
      expect(queuedIds()).toEqual(['unstamped'])
    })
  })

  it('a transport failure reports both new fields empty', async () => {
    fetchServerChanges.mockRejectedValueOnce(new Error('offline'))

    const result = await service.pull()

    expect(result.success).toBe(false)
    expect(result.discardedForDeletedProfile).toEqual([])
    expect(result.droppedDependents).toEqual([])
  })
})
