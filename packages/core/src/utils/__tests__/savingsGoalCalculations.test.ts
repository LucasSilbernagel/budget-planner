import { describe, expect, it } from 'vitest'
import {
  calculateMonthlySavingsNeeded,
  calculateProgress,
  calculateRemaining,
  formatPercentage,
  getProgressInfo,
  getProgressStatus,
} from '../savingsGoalCalculations'

describe('savingsGoalCalculations', () => {
  describe('calculateProgress', () => {
    // AC 5: Given targetAmount = $1000 and currentBalance = $600, returns 60%
    it('should return 60% when currentBalance is 60% of targetAmount', () => {
      const result = calculateProgress(100000, 60000)
      expect(result).toBe(60)
    })

    // AC 6: Given targetAmount = $1000 and currentBalance = $0, returns 0%
    it('should return 0% when currentBalance is 0', () => {
      const result = calculateProgress(100000, 0)
      expect(result).toBe(0)
    })

    // AC 7: Given targetAmount = $1000 and currentBalance = $1000, returns 100%
    it('should return 100% when currentBalance equals targetAmount', () => {
      const result = calculateProgress(100000, 100000)
      expect(result).toBe(100)
    })

    it('should return 0 when targetAmount is 0 (division by zero protection)', () => {
      const result = calculateProgress(0, 100)
      expect(result).toBe(0)
    })

    it('should return 0 when targetAmount is negative', () => {
      const result = calculateProgress(-100, 50)
      expect(result).toBe(0)
    })

    it('should return 50% when currentBalance is half of targetAmount', () => {
      const result = calculateProgress(20000, 10000)
      expect(result).toBe(50)
    })

    it('should return 25% when currentBalance is 25% of targetAmount', () => {
      const result = calculateProgress(40000, 10000)
      expect(result).toBe(25)
    })

    it('should return 75% when currentBalance is 75% of targetAmount', () => {
      const result = calculateProgress(40000, 30000)
      expect(result).toBe(75)
    })

    it('should handle currentBalance exceeding targetAmount', () => {
      // When current exceeds target, progress is capped at 100%
      const result = calculateProgress(10000, 15000)
      expect(result).toBe(100)
    })
  })

  describe('formatPercentage', () => {
    it('should format 60 as "60%"', () => {
      expect(formatPercentage(60)).toBe('60%')
    })

    it('should format 0 as "0%"', () => {
      expect(formatPercentage(0)).toBe('0%')
    })

    it('should format 100 as "100%"', () => {
      expect(formatPercentage(100)).toBe('100%')
    })

    it('should format 33 as "33%"', () => {
      expect(formatPercentage(33)).toBe('33%')
    })
  })

  describe('calculateRemaining', () => {
    it('should return remaining amount when not complete', () => {
      expect(calculateRemaining(10000, 6000)).toBe(4000)
    })

    it('should return 0 when target is reached', () => {
      expect(calculateRemaining(10000, 10000)).toBe(0)
    })

    it('should return 0 when currentBalance exceeds target', () => {
      expect(calculateRemaining(10000, 15000)).toBe(0)
    })

    it('should return targetAmount when currentBalance is 0', () => {
      expect(calculateRemaining(5000, 0)).toBe(5000)
    })
  })

  describe('calculateMonthlySavingsNeeded', () => {
    it('should calculate correct monthly amount for 12 months', () => {
      const result = calculateMonthlySavingsNeeded(120000, 0, 12)
      expect(result).toBe(10000)
    })

    it('should calculate correct monthly amount with existing balance', () => {
      const result = calculateMonthlySavingsNeeded(120000, 60000, 6)
      expect(result).toBe(10000)
    })

    it('should return 0 when months is 0 or negative', () => {
      expect(calculateMonthlySavingsNeeded(10000, 0, 0)).toBe(0)
      expect(calculateMonthlySavingsNeeded(10000, 0, -5)).toBe(0)
    })

    it('should return 0 when goal is already complete', () => {
      const result = calculateMonthlySavingsNeeded(10000, 15000, 12)
      expect(result).toBe(0)
    })

    it('should round up to ensure target is reached', () => {
      // Need 10001 over 3 months = 3333.666... per month, should round to 3334
      const result = calculateMonthlySavingsNeeded(10001, 0, 3)
      expect(result).toBe(3334)
    })
  })

  describe('getProgressStatus', () => {
    it('should return "Complete" when progress is 100', () => {
      expect(getProgressStatus(100)).toBe('Complete')
    })

    it('should return "Complete" when progress is 101', () => {
      expect(getProgressStatus(101)).toBe('Complete')
    })

    it('should return "On Track" when progress is 75', () => {
      expect(getProgressStatus(75)).toBe('On Track')
    })

    it('should return "In Progress" when progress is 50', () => {
      expect(getProgressStatus(50)).toBe('In Progress')
    })

    it('should return "In Progress" when progress is 25', () => {
      expect(getProgressStatus(25)).toBe('In Progress')
    })

    it('should return "Started" when progress is 10', () => {
      expect(getProgressStatus(10)).toBe('Started')
    })

    it('should return "Started" when progress is 1', () => {
      expect(getProgressStatus(1)).toBe('Started')
    })

    it('should return "Not Started" when progress is 0', () => {
      expect(getProgressStatus(0)).toBe('Not Started')
    })

    it('should return "Not Started" when progress is negative', () => {
      expect(getProgressStatus(-5)).toBe('Not Started')
    })
  })

  describe('getProgressInfo', () => {
    it('should return complete progress info for 60% complete goal', () => {
      const info = getProgressInfo(100000, 60000)
      expect(info.percentage).toBe(60)
      expect(info.formattedPercentage).toBe('60%')
      expect(info.remainingAmount).toBe(40000)
      expect(info.status).toBe('In Progress')
      expect(info.isComplete).toBe(false)
    })

    it('should return complete progress info for completed goal', () => {
      const info = getProgressInfo(100000, 100000)
      expect(info.percentage).toBe(100)
      expect(info.formattedPercentage).toBe('100%')
      expect(info.remainingAmount).toBe(0)
      expect(info.status).toBe('Complete')
      expect(info.isComplete).toBe(true)
    })

    it('should return complete progress info for not started goal', () => {
      const info = getProgressInfo(100000, 0)
      expect(info.percentage).toBe(0)
      expect(info.formattedPercentage).toBe('0%')
      expect(info.remainingAmount).toBe(100000)
      expect(info.status).toBe('Not Started')
      expect(info.isComplete).toBe(false)
    })
  })
})
