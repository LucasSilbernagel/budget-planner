/**
 * Pull / reconcile tests for the SynchronizationService (Story 4-18).
 *
 * These exercise the server → client PULL half of multi-device sync:
 *   - pulled create/update applies and is surfaced via onChangesPulled
 *   - a pulled delete tombstone is surfaced so the host can remove it locally
 *   - state-based last-write-wins reconciliation against the unsynced queue:
 *       · a NEWER (or tied) queued local edit is preserved (AC-2)
 *       · a strictly-newer server change wins and drops the stale local op
 *   - the pull cursor (lastPullTimestamp) advances and prevents re-pulling
 *   - empty / future-cursor pulls are a no-op
 *   - a missing transport throws (fails loud, never silent)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SynchronizationService, createSynchronizationService } from '../index'
import type { ServerChange } from '../types'

const testUserId = 'user-abc'

function serverChange(overrides: Partial<ServerChange> = {}): ServerChange {
  return {
    entityType: 'incomeSource',
    entityId: 'srv-1',
    data: { name: 'Salary', amount: 500000, frequency: 'monthly' },
    updatedAt: 1000,
    isDeleted: false,
    ...overrides,
  }
}

describe('SynchronizationService.pull (Story 4-18)', () => {
  let service: SynchronizationService
  let fetchServerChanges: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchServerChanges = vi.fn()
    service = createSynchronizationService(testUserId, {
      autoSync: false,
      debug: false,
      processOperation: async () => ({ success: true }),
      fetchServerChanges,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    service.destroy()
  })

  it('starts with a null pull cursor, tracked separately from the push cursor', () => {
    const state = service.getState()
    expect(state.lastPullTimestamp).toBeNull()
    expect(state.lastSyncTimestamp).toBeNull()
  })

  it('applies a pulled create and surfaces it via onChangesPulled', async () => {
    const change = serverChange({ entityId: 'srv-1', updatedAt: 1500 })
    fetchServerChanges.mockResolvedValue([change])
    const pulled: ServerChange[][] = []
    service.onChangesPulled((changes) => pulled.push(changes))

    const result = await service.pull()

    expect(result.success).toBe(true)
    expect(result.changesPulledCount).toBe(1)
    expect(result.applied).toEqual([change])
    expect(result.conflicts).toEqual([])
    expect(result.lastPullTimestamp).toBe(1500)
    expect(pulled).toEqual([[change]])
    expect(service.getState().lastPullTimestamp).toBe(1500)
  })

  it('passes the current cursor to the transport (null on first pull)', async () => {
    fetchServerChanges.mockResolvedValue([])
    await service.pull()
    expect(fetchServerChanges).toHaveBeenCalledWith(null)
  })

  it('surfaces a pulled delete (tombstone) so the host can remove it locally', async () => {
    const tombstone = serverChange({ entityId: 'srv-9', isDeleted: true, updatedAt: 2000 })
    fetchServerChanges.mockResolvedValue([tombstone])

    const result = await service.pull()

    expect(result.changesPulledCount).toBe(1)
    expect(result.applied[0].isDeleted).toBe(true)
    expect(result.applied[0].entityId).toBe('srv-9')
  })

  it('preserves a NEWER queued local edit against an older server change (AC-2)', async () => {
    // Queue a local update at t=5000.
    vi.setSystemTime(5000)
    await service.queueUpdate(
      'incomeSource',
      'srv-1',
      { name: 'Local newer', amount: 999 },
      testUserId
    )

    // Server change for the same entity is OLDER (t=1000).
    const change = serverChange({ entityId: 'srv-1', updatedAt: 1000 })
    fetchServerChanges.mockResolvedValue([change])
    const pulled: ServerChange[][] = []
    service.onChangesPulled((changes) => pulled.push(changes))

    const result = await service.pull()

    // Server change is SUPPRESSED; the queued local edit survives.
    expect(result.changesPulledCount).toBe(0)
    expect(result.applied).toEqual([])
    expect(result.conflicts).toEqual([change])
    expect(pulled).toEqual([]) // onChangesPulled NOT called when nothing applied
    // The unsynced local op is still queued (never dropped).
    const stillQueued = service
      .getQueue()
      .getAll()
      .some((op) => op.entityId === 'srv-1')
    expect(stillQueued).toBe(true)
  })

  it('server loses a TIE to a still-queued local edit (deviceId tiebreaker rule)', async () => {
    vi.setSystemTime(3000)
    await service.queueUpdate(
      'incomeSource',
      'srv-1',
      { name: 'Local tie', amount: 111 },
      testUserId
    )

    // Equal timestamps → local (still-queued) wins by the defined tiebreaker.
    const change = serverChange({ entityId: 'srv-1', updatedAt: 3000 })
    fetchServerChanges.mockResolvedValue([change])

    const result = await service.pull()

    expect(result.applied).toEqual([])
    expect(result.conflicts).toEqual([change])
    expect(
      service
        .getQueue()
        .getAll()
        .some((op) => op.entityId === 'srv-1')
    ).toBe(true)
  })

  it('a strictly-newer server change wins LWW and drops the stale local op', async () => {
    vi.setSystemTime(1000)
    await service.queueUpdate(
      'incomeSource',
      'srv-1',
      { name: 'Local older', amount: 222 },
      testUserId
    )

    const change = serverChange({ entityId: 'srv-1', updatedAt: 9000 })
    fetchServerChanges.mockResolvedValue([change])

    const result = await service.pull()

    // Server wins → applied; the now-stale local op is removed so it can't
    // re-push older data over the newer server value.
    expect(result.changesPulledCount).toBe(1)
    expect(result.applied).toEqual([change])
    expect(
      service
        .getQueue()
        .getAll()
        .some((op) => op.entityId === 'srv-1')
    ).toBe(false)
  })

  it('advances the cursor and does not re-pull the same change', async () => {
    fetchServerChanges.mockResolvedValueOnce([serverChange({ updatedAt: 4242 })])
    await service.pull()
    expect(service.getState().lastPullTimestamp).toBe(4242)

    // Second pull must pass the advanced cursor so the server filters > 4242.
    fetchServerChanges.mockResolvedValueOnce([])
    await service.pull()
    expect(fetchServerChanges).toHaveBeenLastCalledWith(4242)
  })

  it('advances the cursor to the MAX updatedAt across a batch', async () => {
    fetchServerChanges.mockResolvedValue([
      serverChange({ entityId: 'a', updatedAt: 100 }),
      serverChange({ entityId: 'b', updatedAt: 700 }),
      serverChange({ entityId: 'c', updatedAt: 300 }),
    ])
    const result = await service.pull()
    expect(result.lastPullTimestamp).toBe(700)
  })

  it('is a no-op when the server returns no changes (empty / future cursor)', async () => {
    fetchServerChanges.mockResolvedValue([])
    const pulled: ServerChange[][] = []
    service.onChangesPulled((c) => pulled.push(c))

    const result = await service.pull()

    expect(result.success).toBe(true)
    expect(result.changesPulledCount).toBe(0)
    expect(result.lastPullTimestamp).toBeNull() // cursor unchanged
    expect(pulled).toEqual([])
  })

  it('fails loud (does not no-op) when no transport is configured', async () => {
    const noTransport = createSynchronizationService(testUserId, {
      autoSync: false,
      processOperation: async () => ({ success: true }),
    })
    await expect(noTransport.pull()).rejects.toThrow(/fetchServerChanges/)
    noTransport.destroy()
  })

  it('returns a failure result (cursor unchanged) when the transport throws', async () => {
    fetchServerChanges.mockResolvedValueOnce([serverChange({ updatedAt: 50 })])
    await service.pull() // cursor → 50
    fetchServerChanges.mockRejectedValueOnce(new Error('network down'))

    const result = await service.pull()

    expect(result.success).toBe(false)
    expect(result.error).toContain('network down')
    expect(result.lastPullTimestamp).toBe(50) // unchanged
    expect(service.getState().lastPullTimestamp).toBe(50)
  })

  it('forcePull is an alias for pull (AC-5 manual trigger)', async () => {
    fetchServerChanges.mockResolvedValue([serverChange({ updatedAt: 123 })])
    const result = await service.forcePull()
    expect(result.changesPulledCount).toBe(1)
    expect(result.lastPullTimestamp).toBe(123)
  })

  it('drops ALL queued ops for an entity when the server wins LWW (review P4)', async () => {
    // Two queued ops for the SAME entity: an older create + a newer update.
    vi.setSystemTime(1000)
    await service.queueCreate(
      'incomeSource',
      'srv-1',
      { name: 'older create', amount: 1 },
      testUserId
    )
    vi.setSystemTime(2000)
    await service.queueUpdate(
      'incomeSource',
      'srv-1',
      { name: 'newer update', amount: 2 },
      testUserId
    )
    expect(
      service
        .getQueue()
        .getAll()
        .filter((o) => o.entityId === 'srv-1')
    ).toHaveLength(2)

    // Server change strictly newer than BOTH queued ops → server wins.
    fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 9000 })])
    const result = await service.pull()

    expect(result.changesPulledCount).toBe(1)
    // BOTH ops removed (not just the newest), so the older op can't re-push stale
    // data over the value the pull just applied.
    expect(
      service
        .getQueue()
        .getAll()
        .some((o) => o.entityId === 'srv-1')
    ).toBe(false)
  })

  it('resetPullCursor() clears the cursor so the next pull is a full snapshot (review P7)', async () => {
    fetchServerChanges.mockResolvedValueOnce([serverChange({ updatedAt: 4242 })])
    await service.pull()
    expect(service.getState().lastPullTimestamp).toBe(4242)

    service.resetPullCursor()
    expect(service.getState().lastPullTimestamp).toBeNull()

    fetchServerChanges.mockResolvedValueOnce([])
    await service.pull()
    expect(fetchServerChanges).toHaveBeenLastCalledWith(null)
  })

  it('does NOT advance the cursor past a suppressed change (review D2)', async () => {
    // Local edit newer than the server change → server change suppressed.
    vi.setSystemTime(5000)
    await service.queueUpdate('incomeSource', 'srv-1', { name: 'local', amount: 1 }, testUserId)
    fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 1000 })])

    const result = await service.pull()

    // Suppressed → cursor stays null so the change is re-pulled until the local op
    // pushes, instead of being skipped forever by the server's `> cursor` filter.
    expect(result.conflicts).toHaveLength(1)
    expect(result.lastPullTimestamp).toBeNull()
    expect(service.getState().lastPullTimestamp).toBeNull()
  })

  it('caps the cursor below the earliest suppressed change, not past it (review D2)', async () => {
    vi.setSystemTime(5000)
    await service.queueUpdate('incomeSource', 'srv-2', { name: 'local', amount: 1 }, testUserId)
    fetchServerChanges.mockResolvedValue([
      serverChange({ entityId: 'srv-1', updatedAt: 100 }), // applied (no local op)
      serverChange({ entityId: 'srv-2', updatedAt: 1000 }), // suppressed (local newer)
      serverChange({ entityId: 'srv-3', updatedAt: 2000 }), // applied but AFTER the suppressed one
    ])

    const result = await service.pull()

    // Cursor advances to 100 (the applied change before the suppressed @1000) but
    // not past 1000, so the suppressed change and srv-3 are re-pulled next time.
    expect(result.lastPullTimestamp).toBe(100)
  })

  it('surfaces a discarded local op in conflictOperations so the UI count reflects it (review D4)', async () => {
    vi.setSystemTime(1000)
    await service.queueUpdate(
      'incomeSource',
      'srv-1',
      { name: 'local older', amount: 1 },
      testUserId
    )
    fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 9000 })])

    expect(service.getState().conflictOperations).toHaveLength(0)
    await service.pull()

    // The overwritten local op moved from pending → conflictOperations.
    expect(service.getState().conflictOperations).toHaveLength(1)
    expect(service.getState().conflictOperations[0].entityId).toBe('srv-1')
  })

  it('baseVersion (causal) overrides wall-clock — local wins when change <= base, despite an OLDER op timestamp (review D1)', async () => {
    // Op has an OLD wall-clock timestamp (100) but was based on server version
    // 5000. A server change at updatedAt=5000 is already incorporated by the op.
    vi.setSystemTime(100)
    await service.queueUpdate(
      'incomeSource',
      'srv-1',
      { name: 'local', amount: 1 },
      testUserId,
      undefined,
      5000 // baseVersion
    )
    fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 5000 })])

    const result = await service.pull()

    // Wall-clock LWW would give the server (5000) the win over the op (100), but
    // baseVersion says the op already incorporated v5000 → local wins, op kept.
    expect(result.conflicts).toHaveLength(1)
    expect(result.applied).toHaveLength(0)
    expect(
      service
        .getQueue()
        .getAll()
        .some((o) => o.entityId === 'srv-1')
    ).toBe(true)
  })

  it('baseVersion (causal) overrides wall-clock — server wins when change > base, despite a NEWER op timestamp (review D1)', async () => {
    // Op has a NEWER wall-clock timestamp (9000) but was based on server version
    // 1000. A server change at updatedAt=2000 is a concurrent edit it never saw.
    vi.setSystemTime(9000)
    await service.queueUpdate(
      'incomeSource',
      'srv-1',
      { name: 'local', amount: 1 },
      testUserId,
      undefined,
      1000 // baseVersion
    )
    fetchServerChanges.mockResolvedValue([serverChange({ entityId: 'srv-1', updatedAt: 2000 })])

    const result = await service.pull()

    // Wall-clock LWW would give the op (9000) the win, but baseVersion says the
    // server has a concurrent change (2000 > base 1000) → server wins, op dropped.
    expect(result.applied).toHaveLength(1)
    expect(result.conflicts).toHaveLength(0)
    expect(
      service
        .getQueue()
        .getAll()
        .some((o) => o.entityId === 'srv-1')
    ).toBe(false)
  })
})
