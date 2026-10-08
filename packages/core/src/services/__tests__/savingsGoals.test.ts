import { describe, expect, it } from 'vitest'
import {
  type ClientNewSavingsGoal,
  type ClientSavingsGoal,
  type SavingsGoalWithProgress,
  calculateProgress,
  filterSavingsGoals,
  generateSavingsGoalTempId,
  getStatusFromProgress,
  isSavingsAccount,
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
        id: 'sg-1',
        name: 'Vacation Fund',
        targetAmount: 500000,
        currentBalance: 250000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      expect(goal.id).toBe('sg-1')
      expect(goal.name).toBe('Vacation Fund')
      expect(goal.targetAmount).toBe(500000)
      expect(goal.currentBalance).toBe(250000)
    })

    it('should have ClientNewSavingsGoal interface without ID and timestamps', () => {
      const newGoal: ClientNewSavingsGoal = {
        name: 'Emergency Fund',
        targetAmount: 1000000,
        currentBalance: 0,
      }
      expect(newGoal.name).toBe('Emergency Fund')
      expect(newGoal.targetAmount).toBe(1000000)
      expect(newGoal.currentBalance).toBe(0)
    })

    it('should have SavingsGoalWithProgress interface with progress and status', () => {
      const goalWithProgress: SavingsGoalWithProgress = {
        id: 'sg-1',
        name: 'Car Down Payment',
        targetAmount: 2000000,
        currentBalance: 500000,
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
        id: 'sg-1',
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
        id: 'sg-2',
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
        id: 'sg-3',
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

    it('treats a missing targetAmount as an account, not an error (Story 16-1)', () => {
      const input = {
        name: 'Test',
        currentBalance: 50000,
      }
      const errors = validateSavingsGoal(input)
      expect(errors.some((e) => e.field === 'targetAmount')).toBe(false)
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
      const older = new Date(now.getTime() - 86400000)
      const oldest = new Date(now.getTime() - 172800000)

      const goals: ClientSavingsGoal[] = [
        {
          id: 'sg-1',
          name: 'Oldest',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: oldest.toISOString(),
          updatedAt: oldest.toISOString(),
        },
        {
          id: 'sg-2',
          name: 'Newest',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        {
          id: 'sg-3',
          name: 'Older',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: older.toISOString(),
          updatedAt: older.toISOString(),
        },
      ]

      const sorted = sortByCreationDate(goals)
      expect(sorted[0].id).toBe('sg-2')
      expect(sorted[1].id).toBe('sg-3')
      expect(sorted[2].id).toBe('sg-1')
    })

    it('should return new array (not mutate original)', () => {
      const now = new Date()
      const older = new Date(now.getTime() - 86400000)

      const goals: ClientSavingsGoal[] = [
        {
          id: 'sg-1',
          name: 'Older',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: older.toISOString(),
          updatedAt: older.toISOString(),
        },
        {
          id: 'sg-2',
          name: 'Newest',
          targetAmount: 100,
          currentBalance: 0,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      ]

      const originalOrder = [...goals]
      sortByCreationDate(goals)
      expect(goals).toEqual(originalOrder)
    })
  })

  describe('filterSavingsGoals', () => {
    const goals: SavingsGoalWithProgress[] = [
      {
        id: 'sg-1',
        name: 'Goal A',
        targetAmount: 100,
        currentBalance: 50,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: 50,
        status: 'on-track',
      },
      {
        id: 'sg-2',
        name: 'Goal B',
        targetAmount: 100,
        currentBalance: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: 100,
        status: 'complete',
      },
      {
        id: 'sg-3',
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
      expect(filtered[0].id).toBe('sg-2')
    })

    it('should filter by search term', () => {
      const filtered = filterSavingsGoals(goals, { search: 'Goal A' })
      expect(filtered.length).toBe(1)
      expect(filtered[0].id).toBe('sg-1')
    })

    it('should be case insensitive search', () => {
      const filtered = filterSavingsGoals(goals, { search: 'goal a' })
      expect(filtered.length).toBe(1)
      expect(filtered[0].id).toBe('sg-1')
    })

    it('should return all when no filter provided', () => {
      const filtered = filterSavingsGoals(goals, {})
      expect(filtered.length).toBe(3)
    })
  })

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  describe('generateSavingsGoalTempId', () => {
    it('should generate a uuid string', () => {
      const id1 = generateSavingsGoalTempId()
      expect(typeof id1).toBe('string')
      expect(id1).toMatch(UUID_RE)
    })

    it('should generate unique IDs across calls', () => {
      const ids = new Set([
        generateSavingsGoalTempId(),
        generateSavingsGoalTempId(),
        generateSavingsGoalTempId(),
      ])
      expect(ids.size).toBe(3)
    })
  })

  describe('resetSavingsGoalTempId', () => {
    it('is a stateless no-op and still yields fresh unique uuids', () => {
      const before = generateSavingsGoalTempId()
      resetSavingsGoalTempId()
      const after = generateSavingsGoalTempId()
      expect(after).toMatch(UUID_RE)
      expect(after).not.toBe(before)
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
      expect(result.id).toMatch(UUID_RE)
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

  describe('savings accounts (no target, Story 16-1)', () => {
    const account: ClientSavingsGoal = {
      id: 'acc-1',
      name: 'Checking Buffer',
      targetAmount: null,
      currentBalance: 42000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    describe('isSavingsAccount', () => {
      it('returns true when targetAmount is null', () => {
        expect(isSavingsAccount({ targetAmount: null })).toBe(true)
      })

      it('returns false for a goal with a positive target', () => {
        expect(isSavingsAccount({ targetAmount: 100000 })).toBe(false)
      })
    })

    describe('withProgress', () => {
      it('returns null progress (not 0) and status "account" for an account', () => {
        const result = withProgress(account)
        expect(result.progress).toBeNull()
        expect(result.progress).not.toBe(0)
        expect(result.status).toBe('account')
        expect(result.currentBalance).toBe(42000)
      })

      it('still computes numeric progress for a goal', () => {
        const goal: ClientSavingsGoal = { ...account, targetAmount: 100000, currentBalance: 60000 }
        const result = withProgress(goal)
        expect(result.progress).toBe(60)
        expect(result.status).toBe('on-track')
      })
    })

    describe('validateSavingsGoal', () => {
      it('accepts an account (null target) with just a name and balance', () => {
        const errors = validateSavingsGoal({
          name: 'Buffer',
          targetAmount: null,
          currentBalance: 42000,
        })
        expect(errors).toEqual([])
      })

      it('does not require a target for an account', () => {
        const errors = validateSavingsGoal({
          name: 'Buffer',
          targetAmount: null,
          currentBalance: 0,
        })
        expect(errors.some((e) => e.field === 'targetAmount')).toBe(false)
      })

      it('skips the "balance exceeds target" check for accounts', () => {
        const errors = validateSavingsGoal({
          name: 'Buffer',
          targetAmount: null,
          currentBalance: 9_999_999,
        })
        expect(errors).toEqual([])
      })

      it('still rejects a goal with a missing/zero target', () => {
        const missing = validateSavingsGoal({ name: 'Goal', targetAmount: 0, currentBalance: 0 })
        expect(missing.some((e) => e.field === 'targetAmount')).toBe(true)
      })

      it('still enforces balance <= target for goals', () => {
        const errors = validateSavingsGoal({
          name: 'Goal',
          targetAmount: 100000,
          currentBalance: 200000,
        })
        expect(errors.some((e) => e.field === 'currentBalance')).toBe(true)
      })

      it('still rejects a negative balance on an account', () => {
        const errors = validateSavingsGoal({
          name: 'Buffer',
          targetAmount: null,
          currentBalance: -1,
        })
        expect(errors.some((e) => e.field === 'currentBalance')).toBe(true)
      })
    })
  })
})

describe('savingsGoals — allocation fields (Story 26.1)', () => {
  describe('Type Definitions', () => {
    it('ClientSavingsGoal carries optional monthlyAllocation + allocationMode', () => {
      const manual: ClientSavingsGoal = {
        id: 'sg-1',
        name: 'Vacation',
        targetAmount: null,
        currentBalance: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        allocationMode: 'manual',
        monthlyAllocation: 25000,
      }
      const auto: ClientSavingsGoal = {
        id: 'sg-2',
        name: 'Leftover',
        targetAmount: null,
        currentBalance: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        allocationMode: 'automatic',
        monthlyAllocation: null,
      }
      expect(manual.allocationMode).toBe('manual')
      expect(manual.monthlyAllocation).toBe(25000)
      expect(auto.allocationMode).toBe('automatic')
      expect(auto.monthlyAllocation).toBeNull()
    })

    it('the allocation fields are optional (legacy shape still compiles)', () => {
      const legacy: ClientNewSavingsGoal = {
        name: 'Legacy',
        targetAmount: null,
        currentBalance: 0,
      }
      expect(legacy.allocationMode).toBeUndefined()
      expect(legacy.monthlyAllocation).toBeUndefined()
    })
  })

  describe('validateSavingsGoal — allocation', () => {
    it('accepts automatic mode with no manual amount', () => {
      const errors = validateSavingsGoal({
        name: 'Leftover',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'automatic',
        monthlyAllocation: null,
      })
      expect(errors).toEqual([])
    })

    it('accepts manual mode with a valid non-negative integer amount', () => {
      const errors = validateSavingsGoal({
        name: 'Rent',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'manual',
        monthlyAllocation: 50000,
      })
      expect(errors).toEqual([])
    })

    it('accepts manual mode with a zero amount (>= 0)', () => {
      const errors = validateSavingsGoal({
        name: 'Rent',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'manual',
        monthlyAllocation: 0,
      })
      expect(errors.some((e) => e.field === 'monthlyAllocation')).toBe(false)
    })

    it('rejects a negative manual amount', () => {
      const errors = validateSavingsGoal({
        name: 'Rent',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'manual',
        monthlyAllocation: -1,
      })
      expect(errors.some((e) => e.field === 'monthlyAllocation')).toBe(true)
    })

    it('rejects a non-integer manual amount', () => {
      const errors = validateSavingsGoal({
        name: 'Rent',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'manual',
        monthlyAllocation: 12.5,
      })
      expect(errors.some((e) => e.field === 'monthlyAllocation')).toBe(true)
    })

    it('ignores the manual amount when mode is automatic (no monthlyAllocation error)', () => {
      const errors = validateSavingsGoal({
        name: 'Leftover',
        targetAmount: null,
        currentBalance: 0,
        allocationMode: 'automatic',
        monthlyAllocation: -999,
      })
      expect(errors.some((e) => e.field === 'monthlyAllocation')).toBe(false)
    })

    it('rejects an invalid allocationMode value', () => {
      const errors = validateSavingsGoal({
        name: 'Rent',
        targetAmount: null,
        currentBalance: 0,
        // @ts-expect-error — intentionally invalid mode for the guard test
        allocationMode: 'weekly',
      })
      expect(errors.some((e) => e.field === 'allocationMode')).toBe(true)
    })

    it('accepts input with allocation fields omitted (backward compatible)', () => {
      const errors = validateSavingsGoal({
        name: 'Rent',
        targetAmount: null,
        currentBalance: 0,
      })
      expect(errors).toEqual([])
    })
  })
})
