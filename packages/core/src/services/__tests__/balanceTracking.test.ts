import type { FinanceType } from '@budget-planner/db/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import {
	annualContributionCents,
	type BalanceTrackingFilter,
	type BalanceTrackingWithTimeline,
	type ClientBalanceTracking,
	type ClientNewBalanceTracking,
	debtOwedCents,
	filterBalanceTracking,
	generateBalanceTrackingTempId,
	getTypeDisplayProperties,
	isValidBalanceTracking,
	monthlyContributionCents,
	resetBalanceTrackingTempId,
	resolveDebtPaymentExpense,
	sortByCreationDate,
	toClientBalanceTracking,
	validateBalanceTracking,
	withTimeline,
} from '../balanceTracking'

describe('validateBalanceTracking', () => {
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
			currentBalance: 100000,
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

	it('should REFUSE a negative currentBalance for debts', () => {
		const input: ClientNewBalanceTracking = {
			type: 'debt',
			name: 'Test Debt',
			currentBalance: -100000,
			monthlyContribution: 50000,
			frequency: 'monthly',
		}
		const errors = validateBalanceTracking(input)
		expect(errors).toEqual([
			{
				field: 'currentBalance',
				message: 'Current balance cannot be negative',
				value: -100000,
			},
		])
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

	it.each<[string, { input: ClientNewBalanceTracking }]>([
		[
			'should pass validation for valid input',
			{
				input: {
					type: 'investment',
					name: 'Test Investment',
					currentBalance: 100000,
					monthlyContribution: 50000,
					frequency: 'monthly',
				},
			},
		],
		[
			'should pass validation for an entry carrying only the required fields',
			{
				input: {
					type: 'investment',
					name: 'Test',
					currentBalance: 100000,
					monthlyContribution: 50000,
					frequency: 'monthly',
				},
			},
		],
		[
			'should pass validation for optional monthlyContribution',
			{
				input: {
					type: 'investment',
					name: 'Test',
					currentBalance: 100000,
					monthlyContribution: 0,
					frequency: 'monthly',
				},
			},
		],
	])('%s', (_title, { input }) => {
		expect(validateBalanceTracking(input).length).toBe(0)
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

describe('validateBalanceTracking - frequency', () => {
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

describe('monthlyContributionCents', () => {
	// weekly ×52/12, biweekly ×26/12, monthly ×1, annually ×1/12, then Math.round
	it.each([
		[
			'normalizes a weekly contribution to its monthly equivalent',
			{
				frequency: 'weekly',
				expected: 216667,
			},
		],
		[
			'normalizes a biweekly contribution to its monthly equivalent',
			{
				frequency: 'biweekly',
				expected: 108333,
			},
		],
		['leaves a monthly contribution unchanged', { frequency: 'monthly', expected: 50000 }],
		[
			'normalizes an annual contribution to its monthly equivalent',
			{
				frequency: 'annually',
				expected: 4167,
			},
		],
	] as const)('%s', (_title, { frequency, expected }) => {
		expect(monthlyContributionCents({ monthlyContribution: 50000, frequency })).toBe(expected)
	})

	it('treats a legacy entry with no frequency as monthly (guard)', () => {
		const legacy = { monthlyContribution: 50000 } as Pick<
			ClientBalanceTracking,
			'monthlyContribution' | 'frequency'
		>
		expect(monthlyContributionCents(legacy)).toBe(50000)
	})

	it('coerces an unrecognized frequency to monthly instead of throwing', () => {
		const corrupt = {
			monthlyContribution: 50000,
			frequency: 'daily' as unknown as ClientBalanceTracking['frequency'],
		}
		expect(() => monthlyContributionCents(corrupt)).not.toThrow()
		expect(monthlyContributionCents(corrupt)).toBe(50000)
	})
})

describe('annualContributionCents', () => {
	// `monthlyContributionCents(...) × 12` would give 260004 / 2600004 / 600000 / 50004.
	it.each([
		['weekly', 5000, 260_000],
		['biweekly', 100_000, 2_600_000],
		['monthly', 50_000, 600_000],
		['annually', 50_000, 50_000],
	] as const)('annualises a %s contribution of %i to %i', (frequency, amount, annual) => {
		expect(annualContributionCents({ monthlyContribution: amount, frequency })).toBe(annual)
	})

	it('coerces a missing or unrecognized frequency to monthly, as monthlyContributionCents does', () => {
		const legacy = { monthlyContribution: 50000 } as Pick<
			ClientBalanceTracking,
			'monthlyContribution' | 'frequency'
		>
		const corrupt = {
			monthlyContribution: 50000,
			frequency: 'daily' as unknown as ClientBalanceTracking['frequency'],
		}
		expect(annualContributionCents(legacy)).toBe(600_000)
		expect(annualContributionCents(corrupt)).toBe(600_000)
	})
})

// Debts with a debtSubType: the only branch that still reads the normalized contribution.
describe('withTimeline - frequency normalization', () => {
	it('feeds the monthly-equivalent contribution into the debt payoff timeline', () => {
		// Weekly 50000 → 216667/month: ceil(650000/216667) = 3.
		// An un-normalized 50000 would give ceil(650000/50000) = 13.
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

	it('does not throw when an entry carries a corrupt frequency', () => {
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

describe('withTimeline - non-finite contribution', () => {
	const rows = [
		['investment', undefined],
		['asset', undefined],
		['debt', undefined],
	] as const
	const values = [
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['null', null],
	] as const

	for (const [type] of rows) {
		it.each(values)(`does not throw for a ${type} row with a %s contribution`, (_label, value) => {
			const entry = {
				id: 'test-uuid',
				type,
				name: 'Corrupt',
				currentBalance: 100000,
				monthlyContribution: value,
				frequency: 'monthly',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
			} as unknown as ClientBalanceTracking
			const result = withTimeline(entry)
			expect(result.debtTimeline).toBeNull()
			expect(result.debtProgress).toBeNull()
			expect(result.debtTimelineLabel).toBe('No payment set')
			expect(result.debtProgressLabel).toBe('No limit')
		})
	}

	it('still throws for a debt with a debtSubType and a NaN contribution', () => {
		const entry = {
			id: 'test-uuid',
			type: 'debt',
			debtSubType: 'loan',
			name: 'Corrupt loan',
			currentBalance: -100000,
			monthlyContribution: Number.NaN,
			frequency: 'monthly',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
		} as unknown as ClientBalanceTracking
		expect(() => withTimeline(entry)).toThrow('Amount must be a finite number')
	})
})

describe('sortByCreationDate', () => {
	it('should sort entries by creation date (newest first)', () => {
		const entries: ClientBalanceTracking[] = [
			{
				id: 'bt-1',
				type: 'investment',
				name: 'Oldest',
				currentBalance: 100,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
			},
			{
				id: 'bt-2',
				type: 'investment',
				name: 'Middle',
				currentBalance: 200,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: '2024-02-01T00:00:00Z',
				updatedAt: '2024-02-01T00:00:00Z',
			},
			{
				id: 'bt-3',
				type: 'investment',
				name: 'Newest',
				currentBalance: 300,
				monthlyContribution: 0,
				frequency: 'monthly',
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
				id: 'bt-1',
				type: 'investment',
				name: 'Oldest',
				currentBalance: 100,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
			},
			{
				id: 'bt-2',
				type: 'investment',
				name: 'Newest',
				currentBalance: 200,
				monthlyContribution: 0,
				frequency: 'monthly',
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
			id: 'bt-1',
			type: 'investment',
			name: 'Investment 1',
			currentBalance: 100,
			monthlyContribution: 0,
			frequency: 'monthly',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
		},
		{
			id: 'bt-2',
			type: 'debt',
			name: 'Debt 1',
			currentBalance: -100,
			monthlyContribution: 0,
			frequency: 'monthly',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
		},
		{
			id: 'bt-3',
			type: 'investment',
			name: 'Investment 2',
			currentBalance: 200,
			monthlyContribution: 0,
			frequency: 'monthly',
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
			frequency: 'monthly',
		}
		const result = toClientBalanceTracking(input)

		expect(result.id).toMatch(UUID_RE)
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
		if (!props) throw new Error('no display properties for investment')
		expect(props.theme).toBe('success')
		expect(props.icon).toBe('↗')
		expect(props.label).toBe('Investment')
		expect(props.colorClass).toContain('green')
		expect(props.bgColorClass).toContain('green')
	})

	it('should return debt properties', () => {
		const props = getTypeDisplayProperties('debt')
		if (!props) throw new Error('no display properties for debt')
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
			id: 'bt-1',
			type: 'investment',
			name: 'Test',
			currentBalance: 100000,
			monthlyContribution: 50000,
			frequency: 'monthly',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
		}
		const result = withTimeline(entry)

		expect(result.name).toBe('Test')
		expect(result.debtProgress).toBeNull()
		expect(result.debtTimeline).toBeNull()
		expect('monthsToLimit' in result).toBe(false)
	})
})

describe('Edge Case Handling - Validation', () => {
	beforeEach(() => {
		resetBalanceTrackingTempId()
	})

	describe('NaN and Infinity validation', () => {
		it('should reject NaN currentBalance', () => {
			const input: Partial<ClientNewBalanceTracking> = {
				type: 'investment',
				name: 'Test',
				currentBalance: Number.NaN,
				monthlyContribution: 50000,
			}
			const errors = validateBalanceTracking(input)
			expect(errors.length).toBeGreaterThan(0)
			expect(errors.some((e) => e.field === 'currentBalance' && e.message.includes('finite'))).toBe(
				true
			)
		})

		it('should reject Infinity currentBalance', () => {
			const input: Partial<ClientNewBalanceTracking> = {
				type: 'investment',
				name: 'Test',
				currentBalance: Number.POSITIVE_INFINITY,
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
		it('should reject currentBalance above the largest amount that can sync', () => {
			const input: Partial<ClientNewBalanceTracking> = {
				type: 'investment',
				name: 'Test',
				currentBalance: Number.MAX_SAFE_INTEGER,
				monthlyContribution: 50000,
			}
			const errors = validateBalanceTracking(input)
			expect(errors.length).toBeGreaterThan(0)
			expect(
				errors.some((e) => e.field === 'currentBalance' && e.message.includes('can sync'))
			).toBe(true)
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
					id: 'bt-1',
					type: 'investment',
					name: 'Valid',
					currentBalance: 100,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: '2024-01-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z',
				},
				{
					id: 'bt-2',
					type: 'investment',
					name: 'Invalid Date',
					currentBalance: 200,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: 'invalid-date',
					updatedAt: '2024-01-01T00:00:00Z',
				},
				{
					id: 'bt-3',
					type: 'investment',
					name: 'Another Valid',
					currentBalance: 300,
					monthlyContribution: 0,
					frequency: 'monthly',
					createdAt: '2024-03-01T00:00:00Z',
					updatedAt: '2024-01-01T00:00:00Z',
				},
			]
			const result = sortByCreationDate(entries)
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
				id: 'bt-1',
				type: 'investment',
				name: 'Investment 1',
				currentBalance: 100,
				monthlyContribution: 0,
				frequency: 'monthly',
				createdAt: '2024-01-01T00:00:00Z',
				updatedAt: '2024-01-01T00:00:00Z',
			},
			{
				id: 'bt-2',
				type: 'debt',
				name: 'Debt 1',
				currentBalance: -100,
				monthlyContribution: 0,
				frequency: 'monthly',
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

describe('validateBalanceTracking — the asset type', () => {
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

	it('REJECTS an asset carrying a contribution (enforced on every write path)', () => {
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

describe('validateBalanceTracking — contributionRecordedAsExpense', () => {
	const row = (overrides: Record<string, unknown> = {}) => ({
		type: 'investment' as const,
		name: 'TFSA',
		currentBalance: 1_000_000,
		monthlyContribution: 50_000,
		frequency: 'monthly' as const,
		...overrides,
	})

	// Acceptance first, over the same fixture factory as the rejections, so a broken fixture
	// can't make the rejections pass vacuously.
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

	it('REJECTS an asset row carrying the flag, alongside the asset contribution error', () => {
		// Two independent rules fire here; assert both so neither can mask the other.
		const errors = validateBalanceTracking(
			row({ type: 'asset', contributionRecordedAsExpense: true })
		)
		expect(errors.map((e) => e.field).sort()).toEqual([
			'contributionRecordedAsExpense',
			'monthlyContribution',
		])
	})

	it('does NOT reject a non-investment row whose flag is false or absent', () => {
		expect(
			validateBalanceTracking({
				type: 'debt' as const,
				name: 'Mortgage',
				// Non-negative so the sign rule can't mask the flag rule under test.
				currentBalance: 30_000_000,
				monthlyContribution: 0,
				frequency: 'monthly' as const,
				contributionRecordedAsExpense: false,
			})
		).toEqual([])
	})
})

describe('validateBalanceTracking — paymentExpenseId', () => {
	const EXPENSE_ID = '44444444-4444-4444-8444-444444444444'
	const row = (overrides: Record<string, unknown> = {}) => ({
		type: 'debt' as const,
		name: 'Car loan',
		currentBalance: 1_200_000,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
		...overrides,
	})

	it('ACCEPTS a debt linked to an expense', () => {
		expect(validateBalanceTracking(row({ paymentExpenseId: EXPENSE_ID }))).toEqual([])
	})

	it('ACCEPTS a debt with no link (null) and with the key absent', () => {
		expect(validateBalanceTracking(row({ paymentExpenseId: null }))).toEqual([])
		expect(validateBalanceTracking(row())).toEqual([])
	})

	it('ACCEPTS an investment and an asset whose link is null', () => {
		expect(
			validateBalanceTracking(
				row({ type: 'investment', monthlyContribution: 50_000, paymentExpenseId: null })
			)
		).toEqual([])
		expect(validateBalanceTracking(row({ type: 'asset', paymentExpenseId: null }))).toEqual([])
	})

	it('REJECTS a link on an investment row: only a debt is paid by an expense', () => {
		const errors = validateBalanceTracking(
			row({ type: 'investment', monthlyContribution: 50_000, paymentExpenseId: EXPENSE_ID })
		)
		expect(errors.map((e) => e.field)).toEqual(['paymentExpenseId'])
	})

	it('REJECTS a link on an asset row', () => {
		const errors = validateBalanceTracking(row({ type: 'asset', paymentExpenseId: EXPENSE_ID }))
		expect(errors.map((e) => e.field)).toEqual(['paymentExpenseId'])
	})

	it('REJECTS a link that is neither a string nor null', () => {
		const errors = validateBalanceTracking(row({ paymentExpenseId: 42 }))
		expect(errors.map((e) => e.field)).toEqual(['paymentExpenseId'])
	})
})

describe('validateBalanceTracking — a balance is never negative', () => {
	const row = (type: FinanceType, currentBalance: number) => ({
		type,
		name: 'Row',
		currentBalance,
		monthlyContribution: 0,
		frequency: 'monthly' as const,
	})

	it('ACCEPTS 0 and a positive balance on every type', () => {
		for (const type of ['investment', 'debt', 'asset'] as const) {
			expect(validateBalanceTracking(row(type, 0))).toEqual([])
			expect(validateBalanceTracking(row(type, 1))).toEqual([])
		}
	})

	it('REFUSES a negative balance on every type, with one currentBalance error', () => {
		for (const type of ['investment', 'debt', 'asset'] as const) {
			expect(validateBalanceTracking(row(type, -1))).toEqual([
				{ field: 'currentBalance', message: 'Current balance cannot be negative', value: -1 },
			])
		}
	})

	it('does not ADD the sign error to a non-integer or non-finite balance (its own error says why)', () => {
		// −Infinity also fails the bounds check, so assert the sign message is absent, not a count.
		for (const bad of [-1.5, Number.NEGATIVE_INFINITY]) {
			const errors = validateBalanceTracking(row('debt', bad))
			expect(errors.some((e) => e.field === 'currentBalance')).toBe(true)
			expect(errors.some((e) => e.message === 'Current balance cannot be negative')).toBe(false)
		}
	})
})

describe('debtOwedCents', () => {
	it('reads a debt as the positive amount owed, whatever its stored sign', () => {
		expect(debtOwedCents(400_000)).toBe(400_000)
		expect(debtOwedCents(-400_000)).toBe(400_000)
		expect(debtOwedCents(0)).toBe(0)
	})

	it('returns a non-finite value UNCHANGED, so corrupt-row handling still sees it', () => {
		// A NaN hidden as 0 would silently drop a debt from net worth.
		expect(debtOwedCents(Number.NaN)).toBeNaN()
		expect(debtOwedCents(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
		expect(debtOwedCents(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY)
	})
})

describe('resolveDebtPaymentExpense', () => {
	const expenses = [
		{ id: 'e-1', name: 'Car payment', amount: 45_000, frequency: 'monthly' as const },
		{ id: 'e-2', name: 'Rent', amount: 150_000, frequency: 'monthly' as const },
	]

	it('returns the linked expense for a debt', () => {
		expect(resolveDebtPaymentExpense({ type: 'debt', paymentExpenseId: 'e-1' }, expenses)).toBe(
			expenses[0]
		)
	})

	it('returns null when the debt is not linked (null or absent)', () => {
		expect(resolveDebtPaymentExpense({ type: 'debt', paymentExpenseId: null }, expenses)).toBeNull()
		expect(resolveDebtPaymentExpense({ type: 'debt' }, expenses)).toBeNull()
	})

	it('⚠️ returns null for a DANGLING link (deleted, not yet pulled, other profile)', () => {
		// The caller passes the active profile's expenses, so all three cases are an id not in the list.
		expect(
			resolveDebtPaymentExpense({ type: 'debt', paymentExpenseId: 'gone' }, expenses)
		).toBeNull()
	})

	it('returns null for a non-string stored value (localStorage is user-editable)', () => {
		for (const bad of [42, true, {}, ['e-1'], '']) {
			expect(
				resolveDebtPaymentExpense({ type: 'debt', paymentExpenseId: bad }, expenses)
			).toBeNull()
		}
	})

	it('returns null for a non-debt row even when it carries a matching id', () => {
		for (const type of ['investment', 'asset', 'mystery']) {
			expect(resolveDebtPaymentExpense({ type, paymentExpenseId: 'e-1' }, expenses)).toBeNull()
		}
	})
})
