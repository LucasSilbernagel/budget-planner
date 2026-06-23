/**
 * Authentication Validation Tests for SynchronizationService
 * 
 * Tests for the security fix that validates userId in queue operations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SynchronizationService } from '../synchronization'

describe('SynchronizationService Authentication Validation', () => {
  let service: SynchronizationService
  const validUserId = 'user-123'
  const invalidUserId = 'user-456'

  beforeEach(() => {
    // Create service with valid user
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
      const operation = await service.queueDelete(
        'incomeSource',
        'inc-1',
        validUserId
      )
      
      expect(operation.userId).toBe(validUserId)
      expect(operation.type).toBe('delete')
    })

    it('should reject operations with mismatched userId', async () => {
      await expect(
        service.queueDelete(
          'incomeSource',
          'inc-1',
          invalidUserId
        )
      ).rejects.toThrow('Unauthorized: Operation userId mismatch')
    })
  })

  describe('Cross-user data tampering prevention', () => {
    it('should prevent user-456 from queuing operations for user-123', async () => {
      // This simulates a security attack where a malicious user
      // tries to queue operations for another user
      const maliciousService = new SynchronizationService(invalidUserId, { autoSync: false })
      
      await expect(
        maliciousService.queueCreate(
          'incomeSource',
          'inc-1',
          { name: 'Fake Income', amount: 10000 },
          validUserId  // Trying to create for user-123
        )
      ).rejects.toThrow('Unauthorized: Operation userId mismatch')
    })
  })
})
