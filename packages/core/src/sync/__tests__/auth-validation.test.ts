import { beforeEach, describe, expect, it } from 'vitest'
import { SynchronizationService } from '../synchronization'

describe('SynchronizationService Authentication Validation', () => {
  let service: SynchronizationService
  const validUserId = 'user-123'
  const invalidUserId = 'user-456'

  beforeEach(() => {
    service = new SynchronizationService(validUserId, { autoSync: false })
  })

  describe('queueCreate', () => {
    it('should accept operations with matching userId', async () => {
      const operation = await service.queueCreate(
        'incomeSource',
        'inc-1',
        { name: 'Salary', amount: 5000 },
        validUserId
      )

      expect(operation.userId).toBe(validUserId)
      expect(operation.entityType).toBe('incomeSource')
    })

    it('should reject operations with mismatched userId', async () => {
      await expect(
        service.queueCreate(
          'incomeSource',
          'inc-1',
          { name: 'Salary', amount: 5000 },
          invalidUserId
        )
      ).rejects.toThrow('Unauthorized: Operation userId mismatch')
    })
  })

  describe('queueUpdate', () => {
    it('should accept operations with matching userId', async () => {
      const operation = await service.queueUpdate(
        'incomeSource',
        'inc-1',
        { name: 'Updated Salary', amount: 6000 },
        validUserId
      )

      expect(operation.userId).toBe(validUserId)
      expect(operation.type).toBe('update')
    })

    it('should reject operations with mismatched userId', async () => {
      await expect(
        service.queueUpdate(
          'incomeSource',
          'inc-1',
          { name: 'Updated Salary', amount: 6000 },
          invalidUserId
        )
      ).rejects.toThrow('Unauthorized: Operation userId mismatch')
    })
  })

  describe('queueDelete', () => {
    it('should accept operations with matching userId', async () => {
      const operation = await service.queueDelete('incomeSource', 'inc-1', validUserId)

      expect(operation.userId).toBe(validUserId)
      expect(operation.type).toBe('delete')
    })

    it('should reject operations with mismatched userId', async () => {
      await expect(service.queueDelete('incomeSource', 'inc-1', invalidUserId)).rejects.toThrow(
        'Unauthorized: Operation userId mismatch'
      )
    })
  })

  describe('Cross-user data tampering prevention', () => {
    it('should prevent user-456 from queuing operations for user-123', async () => {
      const maliciousService = new SynchronizationService(invalidUserId, { autoSync: false })

      await expect(
        maliciousService.queueCreate(
          'incomeSource',
          'inc-1',
          { name: 'Fake Income', amount: 10000 },
          validUserId
        )
      ).rejects.toThrow('Unauthorized: Operation userId mismatch')
    })
  })
})
