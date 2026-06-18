/**
 * Balance Tracking Service Tests
 * 
 * Unit tests for balance tracking service layer.
 * Tests validation, sorting, filtering, and utility functions.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ClientBalanceTracking,
  ClientNewBalanceTracking,
  validateBalanceTracking,
  isValidBalanceTracking,
  sortByCreationDate,
  filterBalanceTracking,
  generateBalanceTrackingTempId,
  resetBalanceTrackingTempId,
  toClientBalanceTracking,
  getTypeDisplayProperties,
  withTimeline,
  BalanceTrackingWithTimeline,
} from '../balanceTracking'

// AC references for test documentation
// AC 1: Create Balance Entry
// AC 2: Read Balance Entries
// AC 3: Update Balance Entry
// AC 4: Delete Balance Entry
// AC 5: Type Display
// AC 6: Contribution Tracking

describe('validateBalanceTracking', () => {
  it('should pass validation for valid input', () => {
    const input: ClientNewBalanceTracking = {
      type: 'investment',
      name: 'Test Investment',
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBe(0)
  })

  it('should fail validation for empty name', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      type: 'investment',
      name: '',
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.field === 'name')).toBe(true)
  })

  it('should fail validation for name exceeding 100 characters', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      type: 'investment',
      name: 'a'.repeat(101),
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.field === 'name' && e.message.includes('100'))).toBe(true)
  })

  it('should fail validation for missing type', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.field === 'type')).toBe(true)
  })

  it('should fail validation for invalid type', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      type: 'invalid' as 'investment' | 'debt',
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.field === 'type' && e.message.includes('investment'))).toBe(true)
  })

  it('should pass validation for both investment and debt types', () => {
    const investment: ClientNewBalanceTracking = {
      type: 'investment',
      name: 'Investment',
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    const debt: ClientNewBalanceTracking = {
      type: 'debt',
      name: 'Debt',
      currentBalance: -100000,
      monthlyContribution: 50000,
    }
    expect(validateBalanceTracking(investment).length).toBe(0)
    expect(validateBalanceTracking(debt).length).toBe(0)
  })

  it('should fail validation for missing currentBalance', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      type: 'investment',
      name: 'Test',
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.field === 'currentBalance')).toBe(true)
  })

  it('should fail validation for non-integer currentBalance', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100.5,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('integer'))).toBe(true)
  })

  it('should allow negative currentBalance for debts', () => {
    const input: ClientNewBalanceTracking = {
      type: 'debt',
      name: 'Test Debt',
      currentBalance: -100000,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBe(0)
  })

  it('should fail validation for negative maxContributionLimit', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      maxContributionLimit: -100,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.field === 'maxContributionLimit' && e.message.includes('negative'))).toBe(true)
  })

  it('should fail validation for negative monthlyContribution', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: -100,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.field === 'monthlyContribution' && e.message.includes('negative'))).toBe(true)
  })

  it('should pass validation for optional maxContributionLimit', () => {
    const input: ClientNewBalanceTracking = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBe(0)
  })

  it('should pass validation for optional monthlyContribution', () => {
    const input: ClientNewBalanceTracking = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: 0,
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBe(0)
  })
})

describe('isValidBalanceTracking', () => {
  it('should return true for valid input', () => {
    const input: ClientNewBalanceTracking = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    expect(isValidBalanceTracking(input)).toBe(true)
  })

  it('should return false for invalid input', () => {
    const input: Partial<ClientNewBalanceTracking> = {
      name: '',
    }
    expect(isValidBalanceTracking(input)).toBe(false)
  })
})

describe('sortByCreationDate', () => {
  it('should sort entries by creation date (newest first)', () => {
    const entries: ClientBalanceTracking[] = [
      { id: 1, type: 'investment', name: 'Oldest', currentBalance: 100, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 2, type: 'investment', name: 'Middle', currentBalance: 200, createdAt: '2024-02-01T00:00:00Z', updatedAt: '2024-02-01T00:00:00Z' },
      { id: 3, type: 'investment', name: 'Newest', currentBalance: 300, createdAt: '2024-03-01T00:00:00Z', updatedAt: '2024-03-01T00:00:00Z' },
    ]
    const sorted = sortByCreationDate(entries)
    expect(sorted[0].name).toBe('Newest')
    expect(sorted[1].name).toBe('Middle')
    expect(sorted[2].name).toBe('Oldest')
  })

  it('should not mutate original array', () => {
    const entries: ClientBalanceTracking[] = [
      { id: 1, type: 'investment', name: 'Oldest', currentBalance: 100, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 2, type: 'investment', name: 'Newest', currentBalance: 200, createdAt: '2024-02-01T00:00:00Z', updatedAt: '2024-02-01T00:00:00Z' },
    ]
    const originalOrder = [...entries]
    sortByCreationDate(entries)
    expect(entries).toEqual(originalOrder)
  })

  it('should handle empty array', () => {
    const sorted = sortByCreationDate([])
    expect(sorted).toEqual([])
  })
})

describe('filterBalanceTracking', () => {
  const entries: BalanceTrackingWithTimeline[] = [
    { id: 1, type: 'investment', name: 'Investment 1', currentBalance: 100, monthsToLimit: null, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
    { id: 2, type: 'debt', name: 'Debt 1', currentBalance: -100, monthsToLimit: null, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
    { id: 3, type: 'investment', name: 'Investment 2', currentBalance: 200, monthsToLimit: null, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
  ]

  it('should filter by type (investment)', () => {
    const filtered = filterBalanceTracking(entries, { type: 'investment' })
    expect(filtered.length).toBe(2)
    expect(filtered.every((e) => e.type === 'investment')).toBe(true)
  })

  it('should filter by type (debt)', () => {
    const filtered = filterBalanceTracking(entries, { type: 'debt' })
    expect(filtered.length).toBe(1)
    expect(filtered[0].name).toBe('Debt 1')
  })

  it('should filter by search term', () => {
    const filtered = filterBalanceTracking(entries, { search: 'Investment' })
    expect(filtered.length).toBe(2)
    expect(filtered.every((e) => e.name.includes('Investment'))).toBe(true)
  })

  it('should filter by search term case-insensitive', () => {
    const filtered = filterBalanceTracking(entries, { search: 'investment' })
    expect(filtered.length).toBe(2)
  })

  it('should return all entries when filter is empty', () => {
    const filtered = filterBalanceTracking(entries, {})
    expect(filtered.length).toBe(3)
  })

  it('should return empty array when no matches', () => {
    const filtered = filterBalanceTracking(entries, { type: 'investment', search: 'Nonexistent' })
    expect(filtered.length).toBe(0)
  })
})

describe('generateBalanceTrackingTempId', () => {
  beforeEach(() => {
    resetBalanceTrackingTempId()
  })

  it('should generate negative IDs', () => {
    const id = generateBalanceTrackingTempId()
    expect(id).toBeLessThan(0)
  })

  it('should generate unique IDs for each call', () => {
    const id1 = generateBalanceTrackingTempId()
    const id2 = generateBalanceTrackingTempId()
    expect(id1).not.toBe(id2)
  })

  it('should start at -30000 and decrement', () => {
    resetBalanceTrackingTempId()
    const id1 = generateBalanceTrackingTempId()
    const id2 = generateBalanceTrackingTempId()
    expect(id1).toBe(-30000)
    expect(id2).toBe(-30001)
  })
})

describe('resetBalanceTrackingTempId', () => {
  it('should reset counter to -30000', () => {
    // Generate some IDs to move counter
    generateBalanceTrackingTempId()
    generateBalanceTrackingTempId()
    
    resetBalanceTrackingTempId()
    const id = generateBalanceTrackingTempId()
    expect(id).toBe(-30000)
  })
})

describe('toClientBalanceTracking', () => {
  it('should add ID, timestamps, and defaults', () => {
    const input: ClientNewBalanceTracking = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: 50000,
    }
    const result = toClientBalanceTracking(input)
    
    expect(result.id).toBeLessThan(0)
    expect(result.name).toBe('Test')
    expect(result.type).toBe('investment')
    expect(result.currentBalance).toBe(100000)
    expect(result.monthlyContribution).toBe(50000)
    expect(result.createdAt).toBeDefined()
    expect(result.updatedAt).toBeDefined()
  })

  it('should handle optional maxContributionLimit', () => {
    const input: ClientNewBalanceTracking = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      maxContributionLimit: 500000,
      monthlyContribution: 50000,
    }
    const result = toClientBalanceTracking(input)
    
    expect(result.maxContributionLimit).toBe(500000)
  })
})

describe('getTypeDisplayProperties', () => {
  it('should return investment properties', () => {
    const props = getTypeDisplayProperties('investment')
    expect(props.theme).toBe('success')
    expect(props.icon).toBe('↗')
    expect(props.label).toBe('Investment')
    expect(props.colorClass).toContain('green')
    expect(props.bgColorClass).toContain('green')
  })

  it('should return debt properties', () => {
    const props = getTypeDisplayProperties('debt')
    expect(props.theme).toBe('danger')
    expect(props.icon).toBe('↓')
    expect(props.label).toBe('Debt')
    expect(props.colorClass).toContain('red')
    expect(props.bgColorClass).toContain('red')
  })
})

describe('withTimeline', () => {
  it('should add monthsToLimit from entry data', () => {
    const entry: ClientBalanceTracking = {
      id: 1,
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      maxContributionLimit: 500000,
      monthlyContribution: 50000,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    const result = withTimeline(entry)
    
    expect(result.monthsToLimit).toBe(8) // (500000 - 100000) / 50000 = 8
    expect(result.name).toBe('Test')
  })

  it('should return null for monthsToLimit when no limit', () => {
    const entry: ClientBalanceTracking = {
      id: 1,
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: 50000,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    const result = withTimeline(entry)
    
    expect(result.monthsToLimit).toBeNull()
  })
})

// ============================================================================
// Edge Case Tests - Addressing code review findings
// ============================================================================

describe('Edge Case Handling - Validation', () => {
  beforeEach(() => {
    resetBalanceTrackingTempId()
  })

  describe('NaN and Infinity validation', () => {
    it('AC 2 - should reject NaN currentBalance', () => {
      const input: Partial<ClientNewBalanceTracking> = {
        type: 'investment',
        name: 'Test',
        currentBalance: NaN,
        monthlyContribution: 50000,
      }
      const errors = validateBalanceTracking(input)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('finite'))).toBe(true)
    })

    it('AC 2 - should reject Infinity currentBalance', () => {
      const input: Partial<ClientNewBalanceTracking> = {
        type: 'investment',
        name: 'Test',
        currentBalance: Infinity,
        monthlyContribution: 50000,
      }
      const errors = validateBalanceTracking(input)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('finite'))).toBe(true)
    })

    it('AC 2 - should reject NaN maxContributionLimit', () => {
      const input: Partial<ClientNewBalanceTracking> = {
        type: 'investment',
        name: 'Test',
        currentBalance: 100000,
        maxContributionLimit: NaN,
        monthlyContribution: 50000,
      }
      const errors = validateBalanceTracking(input)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.field === 'maxContributionLimit' && e.message.includes('finite'))).toBe(true)
    })

    it('AC 2 - should reject Infinity maxContributionLimit', () => {
      const input: Partial<ClientNewBalanceTracking> = {
        type: 'investment',
        name: 'Test',
        currentBalance: 100000,
        maxContributionLimit: Infinity,
        monthlyContribution: 50000,
      }
      const errors = validateBalanceTracking(input)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.field === 'maxContributionLimit' && e.message.includes('finite'))).toBe(true)
    })
  })

  describe('Bounds validation', () => {
    it('should reject currentBalance exceeding safe integer bounds', () => {
      const input: Partial<ClientNewBalanceTracking> = {
        type: 'investment',
        name: 'Test',
        currentBalance: Number.MAX_SAFE_INTEGER,
        monthlyContribution: 50000,
      }
      const errors = validateBalanceTracking(input)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('bounds'))).toBe(true)
    })

    it('should reject maxContributionLimit exceeding safe integer bounds', () => {
      const input: Partial<ClientNewBalanceTracking> = {
        type: 'investment',
        name: 'Test',
        currentBalance: 100000,
        maxContributionLimit: Number.MAX_SAFE_INTEGER,
        monthlyContribution: 50000,
      }
      const errors = validateBalanceTracking(input)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors.some((e) => e.field === 'maxContributionLimit' && e.message.includes('bounds'))).toBe(true)
    })
  })

  describe('Type validation for getTypeDisplayProperties', () => {
    it('should return undefined for invalid type', () => {
      const result = getTypeDisplayProperties('invalid' as FinanceType)
      expect(result).toBeUndefined()
    })

    it('should return investment properties for valid investment type', () => {
      const result = getTypeDisplayProperties('investment')
      expect(result).toBeDefined()
      expect(result?.theme).toBe('success')
      expect(result?.icon).toBe('↗')
    })

    it('should return debt properties for valid debt type', () => {
      const result = getTypeDisplayProperties('debt')
      expect(result).toBeDefined()
      expect(result?.theme).toBe('danger')
      expect(result?.icon).toBe('↓')
    })
  })
})

describe('Edge Case Handling - Sorting and Filtering', () => {
  describe('sortByCreationDate with edge cases', () => {
    it('should handle null entries', () => {
      const result = sortByCreationDate(null as unknown as ClientBalanceTracking[])
      expect(result).toEqual([])
    })

    it('should handle undefined entries', () => {
      const result = sortByCreationDate(undefined as unknown as ClientBalanceTracking[])
      expect(result).toEqual([])
    })

    it('should handle invalid date strings', () => {
      const entries: ClientBalanceTracking[] = [
        { id: 1, type: 'investment', name: 'Valid', currentBalance: 100, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 2, type: 'investment', name: 'Invalid Date', currentBalance: 200, createdAt: 'invalid-date', updatedAt: '2024-01-01T00:00:00Z' },
        { id: 3, type: 'investment', name: 'Another Valid', currentBalance: 300, createdAt: '2024-03-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ]
      const result = sortByCreationDate(entries)
      // Invalid date should be pushed to end
      expect(result.length).toBe(3)
      expect(result[0].name).toBe('Another Valid')
      expect(result[1].name).toBe('Valid')
    })

    it('should handle empty array', () => {
      const result = sortByCreationDate([])
      expect(result).toEqual([])
    })
  })

  describe('filterBalanceTracking with edge cases', () => {
    const entries: BalanceTrackingWithTimeline[] = [
      { id: 1, type: 'investment', name: 'Investment 1', currentBalance: 100, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 2, type: 'debt', name: 'Debt 1', currentBalance: -100, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
    ]

    it('should handle null entries', () => {
      const result = filterBalanceTracking(null as unknown as BalanceTrackingWithTimeline[], { type: 'investment' })
      expect(result).toEqual([])
    })

    it('should handle undefined filter', () => {
      const result = filterBalanceTracking(entries, undefined as unknown as BalanceTrackingFilter)
      expect(result).toEqual([])
    })

    it('should handle non-string search', () => {
      const result = filterBalanceTracking(entries, { search: 123 as unknown as string })
      expect(result).toEqual([])
    })

    it('should handle non-string entry name', () => {
      const badEntries = [{ ...entries[0], name: 123 }] as unknown as BalanceTrackingWithTimeline[]
      const result = filterBalanceTracking(badEntries, { search: 'test' })
      expect(result).toEqual([])
    })
  })
})
