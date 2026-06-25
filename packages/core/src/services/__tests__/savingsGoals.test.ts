import { beforeEach, describe, expect, it } from 'vitest'
import {
  ClientNewSavingsGoal,
  ClientSavingsGoal,
  SavingsGoalWithProgress,
  calculateProgress,
  filterSavingsGoals,
  generateSavingsGoalTempId,
  getStatusFromProgress,
  isValidSavingsGoal,
  resetSavingsGoalTempId,
  sortByCreationDate,
  toClientSavingsGoal,
  validateSavingsGoal,
  withProgress,
} from '../savingsGoals'

describe('savingsGoals service', () => {
  describe('Type Definitions', () => {
    it('should have ClientSavingsGoal interface with required fields', () => {
      const goal: ClientSavingsGoal = {
        id: 1,
        name: 'Vacation Fund',
        targetAmount: 500000, // $5000 in cents
        currentBalance: 250000, // $2500 in cents
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      expect(goal.id).toBe(1)
      expect(goal.name).toBe('Vacation Fund')
      expect(goal.targetAmount).toBe(500000)
      expect(goal.currentBalance).toBe(250000)
    })

    it('should have ClientNewSavingsGoal interface without ID and timestamps', () => {
      const newGoal: ClientNewSavingsGoal = {
        name: 'Emergency Fund',
        targetAmount: 1000000, // $10000 in cents
        currentBalance: 0,
      }
      expect(newGoal.name).toBe('Emergency Fund')
      expect(newGoal.targetAmount).toBe(1000000)
      expect(newGoal.currentBalance).toBe(0)
    })

    it('should have SavingsGoalWithProgress interface with progress and status', () => {
      const goalWithProgress: SavingsGoalWithProgress = {
        id: 1,
        name: 'Car Down Payment',
        targetAmount: 2000000, // $20000 in cents
        currentBalance: 500000, // $5000 in cents
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: 25,
        status: 'on-track',
      }
      expect(goalWithProgress.progress).toBe(25)
      expect(goalWithProgress.status).toBe('on-track')
    })
  })

  describe('calculateProgress', () => {
    it('should return 60 for 60000/100000', () => {
      expect(calculateProgress(100000, 60000)).toBe(60)
    })

    it('should return 0 for 0/100000', () => {
      expect(calculateProgress(100000, 0)).toBe(0)
    })

    it('should return 100 for 100000/100000', () => {
      expect(calculateProgress(100000, 100000)).toBe(100)
    })

    it('should return 0 when targetAmount is 0', () => {
      expect(calculateProgress(0, 100)).toBe(0)
    })

    it('should return 0 when targetAmount is negative', () => {
      expect(calculateProgress(-100, 50)).toBe(0)
    })
  })

  describe('getStatusFromProgress', () => {
    it('should return "complete" for 100%', () => {
      expect(getStatusFromProgress(100)).toBe('complete')
    })

    it('should return "on-track" for 50%', () => {
      expect(getStatusFromProgress(50)).toBe('on-track')
    })

    it('should return "on-track" for 1%', () => {
      expect(getStatusFromProgress(1)).toBe('on-track')
    })

    it('should return "not-started" for 0%', () => {
      expect(getStatusFromProgress(0)).toBe('not-started')
    })
  })

  describe('withProgress', () => {
    it('should add progress and status to savings goal', () => {
      const goal: ClientSavingsGoal = {
        id: 1,
        name: 'Test Goal',
        targetAmount: 100000,
        currentBalance: 60000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = withProgress(goal)
      expect(result.progress).toBe(60)
      expect(result.status).toBe('on-track')
      expect(result.name).toBe('Test Goal')
    })

    it('should return 100% progress for complete goal', () => {
      const goal: ClientSavingsGoal = {
        id: 2,
        name: 'Complete Goal',
        targetAmount: 100000,
        currentBalance: 100000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = withProgress(goal)
      expect(result.progress).toBe(100)
      expect(result.status).toBe('complete')
    })

    it('should return 0% progress for not started goal', () => {
      const goal: ClientSavingsGoal = {
        id: 3,
        name: 'Not Started Goal',
        targetAmount: 100000,
        currentBalance: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const result = withProgress(goal)
      expect(result.progress).toBe(0)
      expect(result.status).toBe('not-started')
    })
  })

  describe('validateSavingsGoal', () => {
    it('should return empty array for valid input', () => {
      const input: ClientNewSavingsGoal = {
        name: 'Valid Goal',
        targetAmount: 100000,
        currentBalance: 50000,
      }
      expect(validateSavingsGoal(input)).toEqual([])
    })

    it('should return error for missing name', () => {
      const input = {
        targetAmount: 100000,
        currentBalance: 50000,
      }
      const errors = validateSavingsGoal(input)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.field === 'name')).toBe(true)
    })

    it('should return error for empty name', () => {
      const input = {
        name: '',
        targetAmount: 100000,
        currentBalance: 50000,
      }
      const errors = validateSavingsGoal(input)
      expect(errors.some((e) => e.field === 'name' && e.message === 'Name is required')).toBe(true)
    })

    it('should return error for name longer than 100 characters', () => {
      const input = {
        name: 'a'.repeat(101),
        targetAmount: 100000,
        currentBalance: 50000,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some(
          (e) => e.field === 'name' && e.message === 'Name must be 100 characters or less'
        )
      ).toBe(true)
    })

    it('should return error for missing targetAmount', () => {
      const input = {
        name: 'Test',
        currentBalance: 50000,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some((e) => e.field === 'targetAmount' && e.message === 'Target amount is required')
      ).toBe(true)
    })

    it('should return error for negative targetAmount', () => {
      const input = {
        name: 'Test',
        targetAmount: -100,
        currentBalance: 50000,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some(
          (e) => e.field === 'targetAmount' && e.message === 'Target amount must be positive'
        )
      ).toBe(true)
    })

    it('should return error for zero targetAmount', () => {
      const input = {
        name: 'Test',
        targetAmount: 0,
        currentBalance: 50000,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some(
          (e) => e.field === 'targetAmount' && e.message === 'Target amount must be positive'
        )
      ).toBe(true)
    })

    it('should return error for non-integer targetAmount', () => {
      const input = {
        name: 'Test',
        targetAmount: 100.5,
        currentBalance: 50000,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some(
          (e) =>
            e.field === 'targetAmount' &&
            e.message === 'Target amount must be an integer (in cents)'
        )
      ).toBe(true)
    })

    it('should return error for missing currentBalance', () => {
      const input = {
        name: 'Test',
        targetAmount: 100000,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some(
          (e) => e.field === 'currentBalance' && e.message === 'Current balance is required'
        )
      ).toBe(true)
    })

    it('should return error for negative currentBalance', () => {
      const input = {
        name: 'Test',
        targetAmount: 100000,
        currentBalance: -100,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some(
          (e) => e.field === 'currentBalance' && e.message === 'Current balance cannot be negative'
        )
      ).toBe(true)
    })

    it('should return error for currentBalance exceeding targetAmount', () => {
      const input = {
        name: 'Test',
        targetAmount: 100000,
        currentBalance: 150000,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some(
          (e) =>
            e.field === 'currentBalance' &&
            e.message === 'Current balance cannot exceed target amount'
        )
      ).toBe(true)
    })

    it('should return error for non-integer currentBalance', () => {
      const input = {
        name: 'Test',
        targetAmount: 100000,
        currentBalance: 50.5,
      }
      const errors = validateSavingsGoal(input)
      expect(
        errors.some(
          (e) =>
            e.field === 'currentBalance' &&
            e.message === 'Current balance must be an integer (in cents)'
        )
      ).toBe(true)
    })
  })

  describe('isValidSavingsGoal', () => {
    it('should return true for valid input', () => {
      const input: ClientNewSavingsGoal = {
        name: 'Valid Goal',
        targetAmount: 100000,
        currentBalance: 50000,
      }
      expect(isValidSavingsGoal(input)).toBe(true)
    })

    it('should return false for invalid input', () => {
      const input = {
        name: '',
        targetAmount: -100,
        currentBalance: -50,
      }
      expect(isValidSavingsGoal(input)).toBe(false)
    })
  })

  describe('sortByCreationDate', () => {
    it('should sort goals by creation date (newest first)', () => {
      const now = new Date()
      const older = new Date(now.getTime() - 86400000) // Yesterday
      const oldest = new Date(now.getTime() - 172800000) // Two days ago

      const goals: ClientSavingsGoal[] = [
        {
          id: 1,
          name: 'Oldest',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: oldest.toISOString(),
          updatedAt: oldest.toISOString(),
        },
        {
          id: 2,
          name: 'Newest',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        {
          id: 3,
          name: 'Older',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: older.toISOString(),
          updatedAt: older.toISOString(),
        },
      ]

      const sorted = sortByCreationDate(goals)
      expect(sorted[0].id).toBe(2) // Newest first
      expect(sorted[1].id).toBe(3) // Older second
      expect(sorted[2].id).toBe(1) // Oldest last
    })

    it('should return new array (not mutate original)', () => {
      const now = new Date()
      const older = new Date(now.getTime() - 86400000)

      const goals: ClientSavingsGoal[] = [
        {
          id: 1,
          name: 'Older',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: older.toISOString(),
          updatedAt: older.toISOString(),
        },
        {
          id: 2,
          name: 'Newest',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ]

      const originalOrder = [...goals]
      sortByCreationDate(goals)
      expect(goals).toEqual(originalOrder) // Original not mutated
    })
  })

  describe('filterSavingsGoals', () => {
    const goals: SavingsGoalWithProgress[] = [
      {
        id: 1,
        name: 'Goal A',
        targetAmount: 100,
        currentBalance: 50,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: 50,
        status: 'on-track',
      },
      {
        id: 2,
        name: 'Goal B',
        targetAmount: 100,
        currentBalance: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: 100,
        status: 'complete',
      },
      {
        id: 3,
        name: 'Goal C',
        targetAmount: 100,
        currentBalance: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: 0,
        status: 'not-started',
      },
    ]

    it('should filter by status', () => {
      const filtered = filterSavingsGoals(goals, { status: 'complete' })
      expect(filtered.length).toBe(1)
      expect(filtered[0].id).toBe(2)
    })

    it('should filter by search term', () => {
      const filtered = filterSavingsGoals(goals, { search: 'Goal A' })
      expect(filtered.length).toBe(1)
      expect(filtered[0].id).toBe(1)
    })

    it('should be case insensitive search', () => {
      const filtered = filterSavingsGoals(goals, { search: 'goal a' })
      expect(filtered.length).toBe(1)
      expect(filtered[0].id).toBe(1)
    })

    it('should return all when no filter provided', () => {
      const filtered = filterSavingsGoals(goals, {})
      expect(filtered.length).toBe(3)
    })
  })

  describe('generateSavingsGoalTempId', () => {
    beforeEach(() => {
      resetSavingsGoalTempId()
    })

    it('should generate negative IDs starting from -20000', () => {
      resetSavingsGoalTempId()
      const id1 = generateSavingsGoalTempId()
      expect(id1).toBe(-20001)
    })

    it('should decrement counter for each call', () => {
      resetSavingsGoalTempId()
      const id1 = generateSavingsGoalTempId()
      const id2 = generateSavingsGoalTempId()
      const id3 = generateSavingsGoalTempId()

      expect(id1).toBe(-20001)
      expect(id2).toBe(-20002)
      expect(id3).toBe(-20003)
    })

    it('should generate unique IDs', () => {
      resetSavingsGoalTempId()
      const id1 = generateSavingsGoalTempId()
      const id2 = generateSavingsGoalTempId()
      expect(id1).not.toBe(id2)
    })
  })

  describe('resetSavingsGoalTempId', () => {
    it('should reset counter to -20000', () => {
      // Generate some IDs first
      generateSavingsGoalTempId()
      generateSavingsGoalTempId()

      // Reset
      resetSavingsGoalTempId()

      // Next ID should be -20001
      const nextId = generateSavingsGoalTempId()
      expect(nextId).toBe(-20001)
    })
  })

  describe('toClientSavingsGoal', () => {
    it('should add ID and timestamps to new savings goal', () => {
      const input: ClientNewSavingsGoal = {
        name: 'Test Goal',
        targetAmount: 100000,
        currentBalance: 50000,
      }

      const result = toClientSavingsGoal(input)
      expect(result.id).toBeLessThan(0) // Negative ID
      expect(result.name).toBe('Test Goal')
      expect(result.targetAmount).toBe(100000)
      expect(result.currentBalance).toBe(50000)
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
    })

    it('should generate different IDs for different calls', () => {
      resetSavingsGoalTempId()
      const input: ClientNewSavingsGoal = {
        name: 'Test Goal',
        targetAmount: 100000,
        currentBalance: 50000,
      }

      const result1 = toClientSavingsGoal(input)
      const result2 = toClientSavingsGoal(input)

      expect(result1.id).not.toBe(result2.id)
    })
  })
})
