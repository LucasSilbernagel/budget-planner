/**
 * Balance Tracking Service Tests
 *
 * Unit tests for balance tracking service layer.
 * Tests validation, sorting, filtering, and utility functions.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  BalanceTrackingWithTimeline,
  ClientBalanceTracking,
  ClientNewBalanceTracking,
  filterBalanceTracking,
  generateBalanceTrackingTempId,
  getTypeDisplayProperties,
  isValidBalanceTracking,
  monthlyContributionCents,
  resetBalanceTrackingTempId,
  sortByCreationDate,
  toClientBalanceTracking,
  validateBalanceTracking,
  withTimeline,
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
      frequency: 'monthly',
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
      frequency: 'monthly',
    }
    const debt: ClientNewBalanceTracking = {
      type: 'debt',
      name: 'Debt',
      currentBalance: -100000,
      monthlyContribution: 50000,
      frequency: 'weekly',
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
    expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('integer'))).toBe(
      true
    )
  })

  it('should allow negative currentBalance for debts', () => {
    const input: ClientNewBalanceTracking = {
      type: 'debt',
      name: 'Test Debt',
      currentBalance: -100000,
      monthlyContribution: 50000,
      frequency: 'monthly',
    }
    const errors = validateBalanceTracking(input)
    expect(errors.length).toBe(0)
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
    expect(
      errors.some((e) => e.field === 'monthlyContribution' && e.message.includes('negative'))
    ).toBe(true)
  })

  it('should pass validation for an entry carrying only the required fields', () => {
    const input: ClientNewBalanceTracking = {
      type: 'investment',
      name: 'Test',
      currentBalance: 100000,
      monthlyContribution: 50000,
      frequency: 'monthly',
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
      frequency: 'monthly',
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
      frequency: 'monthly',
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

// Story 16-2: contribution frequency validation + normalization
describe('validateBalanceTracking - frequency (Story 16-2)', () => {
  const base: ClientNewBalanceTracking = {
    type: 'investment',
    name: 'Test',
    currentBalance: 100000,
    monthlyContribution: 50000,
    frequency: 'monthly',
  }

  it('should fail validation when frequency is missing', () => {
    const { frequency: _omitted, ...withoutFrequency } = base
    const errors = validateBalanceTracking(withoutFrequency)
    expect(errors.some((e) => e.field === 'frequency')).toBe(true)
  })

  it('should fail validation for an invalid frequency', () => {
    const input = {
      ...base,
      frequency: 'daily' as unknown as ClientNewBalanceTracking['frequency'],
    }
    const errors = validateBalanceTracking(input)
    expect(errors.some((e) => e.field === 'frequency')).toBe(true)
  })

  it.each(['weekly', 'biweekly', 'monthly', 'annually'] as const)(
    'should pass validation for %s',
    (frequency) => {
      const errors = validateBalanceTracking({ ...base, frequency })
      expect(errors.length).toBe(0)
    }
  )
})

describe('monthlyContributionCents (Story 16-2)', () => {
  // 50000 cents at each cadence, normalized to a monthly base (Math.round):
  //   weekly ×52/12, biweekly ×26/12, monthly ×1, annually ×1/12
  it('normalizes a weekly contribution to its monthly equivalent', () => {
    expect(monthlyContributionCents({ monthlyContribution: 50000, frequency: 'weekly' })).toBe(
      216667
    )
  })

  it('normalizes a biweekly contribution to its monthly equivalent', () => {
    expect(monthlyContributionCents({ monthlyContribution: 50000, frequency: 'biweekly' })).toBe(
      108333
    )
  })

  it('leaves a monthly contribution unchanged', () => {
    expect(monthlyContributionCents({ monthlyContribution: 50000, frequency: 'monthly' })).toBe(
      50000
    )
  })

  it('normalizes an annual contribution to its monthly equivalent', () => {
    expect(monthlyContributionCents({ monthlyContribution: 50000, frequency: 'annually' })).toBe(
      4167
    )
  })

  it('treats a legacy entry with no frequency as monthly (guard)', () => {
    // Pre-migration rows may reach core without a frequency; normalization would
    // otherwise throw. The guard keeps them as their current value.
    const legacy = { monthlyContribution: 50000 } as Pick<
      ClientBalanceTracking,
      'monthlyContribution' | 'frequency'
    >
    expect(monthlyContributionCents(legacy)).toBe(50000)
  })

  it('coerces an unrecognized frequency to monthly instead of throwing (review E1)', () => {
    // A corrupt value (tampered localStorage / future enum-rollback) must NOT throw
    // — this runs inside withTimeline during render with no ErrorBoundary.
    const corrupt = {
      monthlyContribution: 50000,
      frequency: 'daily' as unknown as ClientBalanceTracking['frequency'],
    }
    expect(() => monthlyContributionCents(corrupt)).not.toThrow()
    expect(monthlyContributionCents(corrupt)).toBe(50000)
  })
})

/**
 * `withTimeline` — frequency normalization (Story 16-2), re-anchored by story 49.1.
 *
 * ⚠️ These two tests carry STORY 16-2's coverage, not 26.4's, and were NOT deleted
 * with the contribution limit. They previously read the normalized contribution
 * back out through `monthsToLimit`; that field is gone, so they now read it through
 * `debtTimeline`, which is the only surviving output `withTimeline` computes from
 * `monthlyContributionCents`. The ARITHMETIC is deliberately unchanged — same
 * cadence, same amounts, same expected 3 and 2 — so a regression in normalization
 * still reddens exactly as before.
 *
 * The entries are debts with a `debtSubType` because that is the only branch that
 * still consumes the normalized figure (the branch is dormant in `apps/web`, which
 * is why this suite is the only thing pinning it).
 */
describe('withTimeline - frequency normalization (Story 16-2)', () => {
  it('feeds the monthly-equivalent contribution into the debt payoff timeline', () => {
    // Weekly 50000 → 216667/month. Against a 650000 balance: ceil(650000/216667) = 3.
    // A raw (un-normalized) 50000 would wrongly yield ceil(650000/50000) = 13.
    const entry: ClientBalanceTracking = {
      id: 'test-uuid',
      type: 'debt',
      debtSubType: 'loan',
      name: 'Weekly payer',
      currentBalance: -650000,
      monthlyContribution: 50000,
      frequency: 'weekly',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    expect(withTimeline(entry).debtTimeline).toBe(3)
  })

  it('does not throw when an entry carries a corrupt frequency (review E1)', () => {
    const entry: ClientBalanceTracking = {
      id: 'test-uuid',
      type: 'debt',
      debtSubType: 'loan',
      name: 'Corrupt',
      currentBalance: -100000,
      monthlyContribution: 50000,
      frequency: 'daily' as unknown as ClientBalanceTracking['frequency'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    }
    // Coerced to monthly (50000): ceil(100000 / 50000) = 2.
    expect(() => withTimeline(entry)).not.toThrow()
    expect(withTimeline(entry).debtTimeline).toBe(2)
  })
})

describe('sortByCreationDate', () => {
  it('should sort entries by creation date (newest first)', () => {
    const entries: ClientBalanceTracking[] = [
      {
        id: 1,
        type: 'investment',
        name: 'Oldest',
        currentBalance: 100,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 2,
        type: 'investment',
        name: 'Middle',
        currentBalance: 200,
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      },
      {
        id: 3,
        type: 'investment',
        name: 'Newest',
        currentBalance: 300,
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-01T00:00:00Z',
      },
    ]
    const sorted = sortByCreationDate(entries)
    expect(sorted[0].name).toBe('Newest')
    expect(sorted[1].name).toBe('Middle')
    expect(sorted[2].name).toBe('Oldest')
  })

  it('should not mutate original array', () => {
    const entries: ClientBalanceTracking[] = [
      {
        id: 1,
        type: 'investment',
        name: 'Oldest',
        currentBalance: 100,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 2,
        type: 'investment',
        name: 'Newest',
        currentBalance: 200,
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      },
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
    {
      id: 1,
      type: 'investment',
      name: 'Investment 1',
      currentBalance: 100,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 2,
      type: 'debt',
      name: 'Debt 1',
      currentBalance: -100,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 3,
      type: 'investment',
      name: 'Investment 2',
      currentBalance: 200,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
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

// Story 5-14: ids are now client-generated uuids (replacing the old
// localStorage-backed negative-integer counter) so an offline-created row keeps
// the SAME id once synced.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('generateBalanceTrackingTempId', () => {
  it('should generate a uuid string', () => {
    const id = generateBalanceTrackingTempId()
    expect(typeof id).toBe('string')
    expect(id).toMatch(UUID_RE)
  })

  it('should generate unique IDs for each call', () => {
    const id1 = generateBalanceTrackingTempId()
    const id2 = generateBalanceTrackingTempId()
    expect(id1).not.toBe(id2)
  })
})

describe('resetBalanceTrackingTempId', () => {
  it('is a stateless no-op and still yields fresh unique uuids', () => {
    const before = generateBalanceTrackingTempId()
    // No counter to reset; the call must not throw and must not collide ids.
    resetBalanceTrackingTempId()
    const after = generateBalanceTrackingTempId()
    expect(after).toMatch(UUID_RE)
    expect(after).not.toBe(before)
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

    expect(result.id).toMatch(UUID_RE) // client-generated uuid (Story 5-14)
    expect(result.name).toBe('Test')
    expect(result.type).toBe('investment')
    expect(result.currentBalance).toBe(100000)
    expect(result.monthlyContribution).toBe(50000)
    expect(result.createdAt).toBeDefined()
    expect(result.updatedAt).toBeDefined()
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
  it('passes the entry through and adds the debt display fields', () => {
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

    expect(result.name).toBe('Test')
    // Story 49.1: `monthsToLimit` is gone with the contribution-limit concept.
    // A non-debt entry gets the untouched debt defaults.
    expect(result.debtProgress).toBeNull()
    expect(result.debtTimeline).toBeNull()
    expect('monthsToLimit' in result).toBe(false)
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
      expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('finite'))).toBe(
        true
      )
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
      expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('finite'))).toBe(
        true
      )
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
      expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('bounds'))).toBe(
        true
      )
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
        {
          id: 1,
          type: 'investment',
          name: 'Valid',
          currentBalance: 100,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          type: 'investment',
          name: 'Invalid Date',
          currentBalance: 200,
          createdAt: 'invalid-date',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 3,
          type: 'investment',
          name: 'Another Valid',
          currentBalance: 300,
          createdAt: '2024-03-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
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
      {
        id: 1,
        type: 'investment',
        name: 'Investment 1',
        currentBalance: 100,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        id: 2,
        type: 'debt',
        name: 'Debt 1',
        currentBalance: -100,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]

    it('should handle null entries', () => {
      const result = filterBalanceTracking(null as unknown as BalanceTrackingWithTimeline[], {
        type: 'investment',
      })
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

describe('validateBalanceTracking — the asset type (Story 43.4, FR70/D2)', () => {
  const assetInput = (overrides: Record<string, unknown> = {}) => ({
    type: 'asset' as const,
    name: 'Condo',
    currentBalance: 40_000_000,
    monthlyContribution: 0,
    frequency: 'monthly' as const,
    ...overrides,
  })

  it('accepts a valid asset entry', () => {
    const result = validateBalanceTracking(assetInput())
    expect(result).toEqual([])
  })

  it('REJECTS an asset carrying a contribution (D2 enforced on every write path)', () => {
    // ⚠️ Not merely cosmetic. `SavingsPage` sums the `monthlyContribution` of
    // `type === 'investment'` rows into the distributable pool; an asset carrying
    // one is money the user is putting aside that the pool never deducts, so the
    // pool is overstated and every automatic allocation runs too large.
    const errors = validateBalanceTracking(assetInput({ monthlyContribution: 50_000 }))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.field).toBe('monthlyContribution')
    expect(errors[0]?.message).toMatch(/asset has no contribution/i)
  })

  it('still rejects a genuinely unknown type, naming all three valid ones', () => {
    const errors = validateBalanceTracking(assetInput({ type: 'crypto' }))
    expect(errors.some((e) => e.field === 'type')).toBe(true)
    const typeError = errors.find((e) => e.field === 'type')
    expect(typeError?.message).toContain('asset')
    expect(typeError?.message).toContain('investment')
    expect(typeError?.message).toContain('debt')
  })
})

describe('validateBalanceTracking — contributionRecordedAsExpense (Story 45.1, FR72/D8)', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    type: 'investment' as const,
    name: 'TFSA',
    currentBalance: 1_000_000,
    monthlyContribution: 50_000,
    frequency: 'monthly' as const,
    ...overrides,
  })

  // ⚠️ ACCEPTANCE FIRST, and deliberately paired with the rejections below over the
  // SAME fixture factory. Story 43.4 shipped a rejection assertion that passed only
  // because its fixture was malformed and every parse threw — a guard that cannot
  // fail. If the factory ever breaks, these acceptance cases go red and say so.
  it('ACCEPTS an investment row with the flag true', () => {
    expect(validateBalanceTracking(row({ contributionRecordedAsExpense: true }))).toEqual([])
  })

  it('ACCEPTS an investment row with the flag false', () => {
    expect(validateBalanceTracking(row({ contributionRecordedAsExpense: false }))).toEqual([])
  })

  it('ACCEPTS an investment row with the flag absent (the default path)', () => {
    expect(validateBalanceTracking(row())).toEqual([])
  })

  it('REJECTS a debt row carrying the flag — a debt never reaches the pool', () => {
    const errors = validateBalanceTracking(
      row({ type: 'debt', contributionRecordedAsExpense: true })
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]?.field).toBe('contributionRecordedAsExpense')
    expect(errors[0]?.message).toMatch(/already recorded as an expense/i)
  })

  it('REJECTS an asset row carrying the flag, alongside the D2 contribution error', () => {
    // Two independent rules fire here; assert BOTH so neither can mask the other.
    const errors = validateBalanceTracking(
      row({ type: 'asset', contributionRecordedAsExpense: true })
    )
    expect(errors.map((e) => e.field).sort()).toEqual([
      'contributionRecordedAsExpense',
      'monthlyContribution',
    ])
  })

  it('does NOT reject a non-investment row whose flag is false or absent', () => {
    // The rule keys on `=== true`, so a debt/asset row that merely carries the
    // field at its default is untouched. This is what keeps the sync contract
    // uniform across all three finance types (D8).
    expect(
      validateBalanceTracking({
        type: 'debt' as const,
        name: 'Mortgage',
        currentBalance: -30_000_000,
        monthlyContribution: 0,
        frequency: 'monthly' as const,
        contributionRecordedAsExpense: false,
      })
    ).toEqual([])
  })
})
