import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SyncStatus,
  SynchronizationService,
  createSyncQueue,
  createSynchronizationService,
} from '../index'
import type { SyncOperation } from '../types'

// Monotonic counter so each generated operation gets a unique id even when
// fake timers freeze Date.now(). Two operations sharing an id are treated as
// the same operation by conflict detection, which would mask real conflicts.
let opCounter = 0

// Helper to generate a local test operation (originates on this device)
function createTestOperation(overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    id: `test-op-${Date.now()}-${++opCounter}`,
    type: 'create',
    entityType: 'incomeSource',
    entityId: 'test-id',
    data: { name: 'Test', amount: 1000 },
    timestamp: Date.now(),
    deviceId: 'test-device',
    userId: 'test-user',
    ...overrides,
  }
}

// Helper to generate a server-side operation (originates on a *different*
// device). Conflicts only arise between operations from different devices, so
// cross-device fixtures are required to exercise conflict detection/resolution.
function createServerOperation(overrides: Partial<SyncOperation> = {}): SyncOperation {
  return createTestOperation({ deviceId: 'server-device', ...overrides })
}

describe('Synchronization Service', () => {
  let service: SynchronizationService
  const testUserId = 'test-user-123'

  beforeEach(() => {
    vi.useFakeTimers()
    service = createSynchronizationService(testUserId, {
      autoSync: false,
      debug: false,
      // A transport must be provided: the default processOperation now throws
      // (rather than silently faking success) to avoid silent data loss.
      processOperation: async () => ({ success: true }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    service.destroy()
  })

  describe('Initialization', () => {
    it('should create service with default configuration', () => {
      const config = service.getConfig()
      expect(config.conflictResolutionStrategy).toBe('last-write-wins')
      expect(config.maxRetries).toBe(3)
      expect(config.batchSize).toBe(50)
    })

    it('should generate a device ID', () => {
      const deviceId = service.getDeviceId()
      expect(deviceId).toBeTruthy()
      expect(typeof deviceId).toBe('string')
      expect(deviceId.startsWith('device-')).toBe(true)
    })

    it('should generate a cryptographic (crypto.randomUUID) device ID, not Math.random (Story 5.8)', () => {
      const deviceId = service.getDeviceId()
      // device-<uuid>: the suffix must be a crypto.randomUUID() v4 value, not the
      // old non-cryptographic `Math.random().toString(36)` slug.
      const uuidV4 = /^device-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      expect(deviceId).toMatch(uuidV4)
    })

    it('should initialize with PENDING status', () => {
      const state = service.getState()
      expect(state.status).toBe(SyncStatus.PENDING)
      expect(state.pendingOperations).toHaveLength(0)
    })
  })

  describe('Sync Queue Operations', () => {
    it('should queue create operation', async () => {
      const operation = await service.queueCreate(
        'incomeSource',
        'income-1',
        { name: 'Test Income', amount: 1000 },
        testUserId
      )

      expect(operation.type).toBe('create')
      expect(operation.entityType).toBe('incomeSource')
      expect(operation.entityId).toBe('income-1')

      const state = service.getState()
      expect(state.pendingOperations).toHaveLength(1)
    })

    it('should queue update operation', async () => {
      const operation = await service.queueUpdate(
        'expense',
        'expense-1',
        { name: 'Updated Expense', amount: 500 },
        testUserId,
        1
      )

      expect(operation.type).toBe('update')
      expect(operation.version).toBe(1)

      const state = service.getState()
      expect(state.pendingOperations).toHaveLength(1)
    })

    it('should queue delete operation', async () => {
      const operation = await service.queueDelete('savingsGoal', 'goal-1', testUserId)

      expect(operation.type).toBe('delete')
      expect(operation.data).toEqual({})

      const state = service.getState()
      expect(state.pendingOperations).toHaveLength(1)
    })
  })

  describe('Conflict Detection', () => {
    it('should detect conflict between update and delete on same entity', () => {
      const localOp = createTestOperation({
        type: 'update',
        entityType: 'expense',
        entityId: 'expense-1',
      })

      const serverOp = createServerOperation({
        type: 'delete',
        entityType: 'expense',
        entityId: 'expense-1',
      })

      const result = service.detectConflict(localOp, serverOp)
      expect(result.hasConflict).toBe(true)
      expect(result.conflictType).toBe('update-delete')
    })

    it('should detect conflict when updates have different data', () => {
      const localOp = createTestOperation({
        type: 'update',
        entityType: 'balanceTracking',
        entityId: 'balance-1',
        data: { name: 'Local Balance', amount: 1000 },
      })

      const serverOp = createServerOperation({
        type: 'update',
        entityType: 'balanceTracking',
        entityId: 'balance-1',
        data: { name: 'Server Balance', amount: 2000 },
      })

      const result = service.detectConflict(localOp, serverOp)
      expect(result.hasConflict).toBe(true)
      expect(result.conflictType).toBe('version-mismatch')
    })

    it('should NOT detect conflict for operations from the same device', () => {
      const localOp = createTestOperation({ type: 'update', entityId: 'income-1' })
      const serverOp = createTestOperation({ type: 'delete', entityId: 'income-1' })
      const result = service.detectConflict(localOp, serverOp)
      expect(result.hasConflict).toBe(false)
    })

    it('should NOT detect conflict for different entities', () => {
      const localOp = createTestOperation({ entityId: 'income-1' })
      const serverOp = createServerOperation({ entityId: 'income-2' })
      const result = service.detectConflict(localOp, serverOp)
      expect(result.hasConflict).toBe(false)
    })

    it('should NOT detect conflict for different entity types', () => {
      const localOp = createTestOperation({ entityType: 'incomeSource', entityId: '1' })
      const serverOp = createServerOperation({ entityType: 'expense', entityId: '1' })
      const result = service.detectConflict(localOp, serverOp)
      expect(result.hasConflict).toBe(false)
    })
  })

  describe('Conflict Resolution', () => {
    it('should resolve with last-write-wins strategy (local newer)', () => {
      const localOp = createTestOperation({ type: 'update', timestamp: 2000 })
      const serverOp = createServerOperation({ type: 'delete', timestamp: 1000 })
      const resolved = service.resolveConflict(localOp, serverOp)
      expect(resolved).toEqual(localOp)
    })

    it('should resolve with server-wins strategy', () => {
      const serviceWithStrategy = createSynchronizationService(testUserId, {
        conflictResolutionStrategy: 'server-wins',
        autoSync: false,
      })

      const localOp = createTestOperation({ type: 'update', timestamp: 3000 })
      const serverOp = createServerOperation({ type: 'delete', timestamp: 1000 })
      const resolved = serviceWithStrategy.resolveConflict(localOp, serverOp)
      expect(resolved).toEqual(serverOp)
      serviceWithStrategy.destroy()
    })

    it('should resolve with client-wins strategy', () => {
      const serviceWithStrategy = createSynchronizationService(testUserId, {
        conflictResolutionStrategy: 'client-wins',
        autoSync: false,
      })

      const localOp = createTestOperation({ type: 'update', timestamp: 1000 })
      const serverOp = createServerOperation({ type: 'delete', timestamp: 3000 })
      const resolved = serviceWithStrategy.resolveConflict(localOp, serverOp)
      expect(resolved).toEqual(localOp)
      serviceWithStrategy.destroy()
    })

    it('should merge conflicts when using merge strategy', () => {
      const serviceWithStrategy = createSynchronizationService(testUserId, {
        conflictResolutionStrategy: 'merge',
        autoSync: false,
      })

      const localOp = createTestOperation({
        type: 'update',
        data: { name: 'Local', value: 100 },
        timestamp: 1000,
      })
      const serverOp = createServerOperation({
        type: 'update',
        data: { name: 'Server', other: 200 },
        timestamp: 2000,
      })

      const resolved = serviceWithStrategy.resolveConflict(localOp, serverOp)
      expect(resolved.data).toEqual({ name: 'Local', value: 100, other: 200 })
      serviceWithStrategy.destroy()
    })

    it('should merge create+create conflicts with merge strategy', () => {
      const serviceWithStrategy = createSynchronizationService(testUserId, {
        conflictResolutionStrategy: 'merge',
        autoSync: false,
      })

      const localOp = createTestOperation({
        type: 'create',
        data: { name: 'Local', value: 100 },
        timestamp: 1000,
      })
      const serverOp = createServerOperation({
        type: 'create',
        data: { name: 'Server', other: 200 },
        timestamp: 2000,
      })

      const resolved = serviceWithStrategy.resolveConflict(localOp, serverOp)
      expect(resolved.type).toBe('create')
      expect(resolved.data).toEqual({ name: 'Local', value: 100, other: 200 })
      serviceWithStrategy.destroy()
    })

    it('should handle delete+create conflicts with merge strategy', () => {
      const serviceWithStrategy = createSynchronizationService(testUserId, {
        conflictResolutionStrategy: 'merge',
        autoSync: false,
      })

      const localOp = createTestOperation({
        type: 'delete',
        data: {},
        timestamp: 1000,
      })
      const serverOp = createServerOperation({
        type: 'create',
        data: { name: 'Server', value: 200 },
        timestamp: 2000,
      })

      const resolved = serviceWithStrategy.resolveConflict(localOp, serverOp)
      expect(resolved.type).toBe('create')
      expect(resolved.data).toEqual({ name: 'Server', value: 200 })
      serviceWithStrategy.destroy()
    })

    it('should handle create+delete conflicts with merge strategy', () => {
      const serviceWithStrategy = createSynchronizationService(testUserId, {
        conflictResolutionStrategy: 'merge',
        autoSync: false,
      })

      const localOp = createTestOperation({
        type: 'create',
        data: { name: 'Local', value: 100 },
        timestamp: 2000,
      })
      const serverOp = createServerOperation({
        type: 'delete',
        data: {},
        timestamp: 1000,
      })

      const resolved = serviceWithStrategy.resolveConflict(localOp, serverOp)
      expect(resolved.type).toBe('create')
      expect(resolved.data).toEqual({ name: 'Local', value: 100 })
      serviceWithStrategy.destroy()
    })

    it('should handle delete+update conflicts with merge strategy', () => {
      const serviceWithStrategy = createSynchronizationService(testUserId, {
        conflictResolutionStrategy: 'merge',
        autoSync: false,
      })

      const localOp = createTestOperation({
        type: 'delete',
        data: {},
        timestamp: 2000,
      })
      const serverOp = createServerOperation({
        type: 'update',
        data: { name: 'Server', value: 200 },
        timestamp: 1000,
      })

      const resolved = serviceWithStrategy.resolveConflict(localOp, serverOp)
      expect(resolved.type).toBe('update')
      expect(resolved.data).toEqual({ name: 'Server', value: 200 })
      serviceWithStrategy.destroy()
    })

    it('should handle update+delete conflicts with merge strategy', () => {
      const serviceWithStrategy = createSynchronizationService(testUserId, {
        conflictResolutionStrategy: 'merge',
        autoSync: false,
      })

      const localOp = createTestOperation({
        type: 'update',
        data: { name: 'Local', value: 100 },
        timestamp: 2000,
      })
      const serverOp = createServerOperation({
        type: 'delete',
        data: {},
        timestamp: 1000,
      })

      const resolved = serviceWithStrategy.resolveConflict(localOp, serverOp)
      expect(resolved.type).toBe('update')
      expect(resolved.data).toEqual({ name: 'Local', value: 100 })
      serviceWithStrategy.destroy()
    })
  })

  describe('Sync State', () => {
    it('should return current state', () => {
      const state = service.getState()
      expect(state).toHaveProperty('status')
      expect(state).toHaveProperty('isOnline')
      expect(state).toHaveProperty('pendingOperations')
    })

    it('should update state when operations are queued', async () => {
      await service.queueCreate('incomeSource', '1', {}, testUserId)
      await service.queueCreate('incomeSource', '2', {}, testUserId)
      const state = service.getState()
      expect(state.pendingOperations).toHaveLength(2)
    })
  })

  describe('SyncQueue', () => {
    it('should add operations to queue', async () => {
      const queue = createSyncQueue(testUserId)
      const operation = createTestOperation()
      await queue.add(operation)
      expect(queue.getAll()).toHaveLength(1)
    })

    it('should add multiple operations', async () => {
      const queue = createSyncQueue(testUserId)
      const op1 = createTestOperation({ id: 'op-1' })
      const op2 = createTestOperation({ id: 'op-2' })
      await queue.addBatch([op1, op2])
      expect(queue.getAll()).toHaveLength(2)
    })

    it('should remove operations by ID', async () => {
      const queue = createSyncQueue(testUserId)
      const operation = createTestOperation({ id: 'op-to-remove' })
      await queue.add(operation)
      expect(queue.getCount()).toBe(1)
      const removed = await queue.remove('op-to-remove')
      expect(removed).toBe(true)
      expect(queue.getCount()).toBe(0)
    })

    it('should clear all operations', async () => {
      const queue = createSyncQueue(testUserId)
      await queue.add(createTestOperation({ id: 'op-1' }))
      await queue.add(createTestOperation({ id: 'op-2' }))
      await queue.clear()
      expect(queue.getCount()).toBe(0)
    })

    it('should get operations by entity type', async () => {
      const queue = createSyncQueue(testUserId)
      await queue.add(createTestOperation({ entityType: 'incomeSource' }))
      await queue.add(createTestOperation({ entityType: 'expense' }))
      await queue.add(createTestOperation({ entityType: 'incomeSource' }))
      const incomeOps = queue.getByEntityType('incomeSource')
      expect(incomeOps).toHaveLength(2)
    })

    it('should check if queue is empty', async () => {
      const queue = createSyncQueue(testUserId)
      expect(queue.isEmpty()).toBe(true)
      await queue.add(createTestOperation())
      expect(queue.isEmpty()).toBe(false)
    })

    it('should dequeue operations (FIFO)', async () => {
      const queue = createSyncQueue(testUserId)
      const op1 = createTestOperation({ id: 'op-1' })
      const op2 = createTestOperation({ id: 'op-2' })
      await queue.addBatch([op1, op2])
      const dequeued1 = await queue.dequeue()
      expect(dequeued1?.id).toBe('op-1')
      expect(queue.getCount()).toBe(1)
      const dequeued2 = await queue.dequeue()
      expect(dequeued2?.id).toBe('op-2')
      expect(queue.getCount()).toBe(0)
    })

    it('should get ready operations sorted by timestamp', async () => {
      const queue = createSyncQueue(testUserId)
      await queue.add(createTestOperation({ timestamp: 3000 }))
      await queue.add(createTestOperation({ timestamp: 1000 }))
      await queue.add(createTestOperation({ timestamp: 2000 }))
      const ready = queue.getReadyOperations()
      expect(ready).toHaveLength(3)
      expect(ready[0].timestamp).toBe(1000)
      expect(ready[1].timestamp).toBe(2000)
      expect(ready[2].timestamp).toBe(3000)
    })
  })
})
