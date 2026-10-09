import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
	ALL_FINANCE_TYPES,
	allTables,
	balanceTracking,
	type CategoryKind,
	type Currency,
	categories,
	categoryKindEnum,
	currencyEnum,
	expenses,
	type FinanceType,
	financeTypeEnum,
	frequencyEnum,
	incomeSources,
	type NewUser,
	type SubscriptionStatus,
	savingsGoals,
	subscriptionStatusEnum,
	type User,
	userProfiles,
	users,
} from './schema'

describe('Schema Compilation', () => {
	it('should export all tables', () => {
		expect(users).toBeDefined()
		expect(incomeSources).toBeDefined()
		expect(expenses).toBeDefined()
		expect(savingsGoals).toBeDefined()
		expect(balanceTracking).toBeDefined()
		expect(userProfiles).toBeDefined()
	})

	it('should export all enums', () => {
		expect(subscriptionStatusEnum).toBeDefined()
		expect(currencyEnum).toBeDefined()
		expect(frequencyEnum).toBeDefined()
		expect(financeTypeEnum).toBeDefined()
	})

	it('should export allTables object', () => {
		expect(allTables).toBeDefined()
		expect(allTables.users).toBe(users)
		expect(allTables.incomeSources).toBe(incomeSources)
		expect(allTables.expenses).toBe(expenses)
		expect(allTables.savingsGoals).toBe(savingsGoals)
		expect(allTables.balanceTracking).toBe(balanceTracking)
		expect(allTables.userProfiles).toBe(userProfiles)
	})
})

describe('Type Generation', () => {
	it('should have User type with correct properties', () => {
		// Checked at compile time by the package's type-check.
		const userExample: User = {
			id: '550e8400-e29b-41d4-a716-446655440000',
			email: 'test@example.com',
			paddleId: 'paddle_123',
			subscriptionStatus: 'free',
			billingInterval: null,
			currency: 'NONE',
			isDeleted: false,
			entitlementUpdatedAt: null,
			emailUpdatedAt: null,
			lifetimeTransactionId: null,
			lifetimeGrantTotal: null,
			sessionsRevokedAt: null,
			accessEndedAt: null,
			retentionNoticeSentAt: null,
			retentionNoticeAttemptedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		}

		expect(userExample.id).toBeDefined()
		expect(userExample.email).toBeDefined()
		expect(userExample.paddleId).toBeDefined()
		expect(userExample.subscriptionStatus).toBeDefined()
		expect(userExample.currency).toBeDefined()
		expect(userExample.createdAt).toBeDefined()
		expect(userExample.updatedAt).toBeDefined()
		expect(userExample.email.length).toBeLessThanOrEqual(254)
	})

	it('should have NewUser type for inserts', () => {
		const newUserExample: NewUser = {
			email: 'new@example.com',
			paddleId: 'paddle_456',
			subscriptionStatus: 'active',
			currency: 'USD',
			createdAt: new Date(),
			updatedAt: new Date(),
		} as NewUser

		expect(newUserExample.email).toBeDefined()
		expect(newUserExample.paddleId).toBeDefined()
		expect(newUserExample.updatedAt).toBeDefined()
	})

	it('should have Currency enum type', () => {
		const currencies: Currency[] = ['NONE', 'USD', 'EUR', 'GBP', 'JPY']
		expect(currencies).toContain('NONE')
		expect(currencies).toContain('USD')
	})

	it('should have SubscriptionStatus enum type', () => {
		const statuses: SubscriptionStatus[] = ['free', 'active', 'past_due', 'canceled']
		expect(statuses).toContain('free')
		expect(statuses).toContain('active')
		expect(statuses).toContain('past_due')
		expect(statuses).toContain('canceled')
		expect(statuses).not.toContain('cancelled')
		expect(statuses).not.toContain('unpaid')
	})
})

describe('Users Table Schema', () => {
	it('should have users table defined', () => {
		expect(users).toBeDefined()
		expect(typeof users).toBe('object')
	})

	it('should have uuid id column', () => {
		expect(users).toBeDefined()
		const testId: string = '550e8400-e29b-41d4-a716-446655440000'
		expect(testId).toBeTruthy()
	})

	it('should have unique and not null paddleId', () => {
		expect(users).toBeDefined()
		const testPaddleId: string = 'paddle_123'
		expect(testPaddleId).toBeTruthy()
	})
})

describe('Foreign Key Relations', () => {
	it('should have userId in all financial tables', () => {
		expect(incomeSources).toBeDefined()
		expect(expenses).toBeDefined()
		expect(savingsGoals).toBeDefined()
		expect(balanceTracking).toBeDefined()
		expect(userProfiles).toBeDefined()
	})

	it('should reference users table', () => {
		expect(incomeSources).toBeDefined()
		expect(expenses).toBeDefined()
		expect(users).toBeDefined()
	})

	it('should have profileId in all financial tables for profile scoping', () => {
		expect(incomeSources).toBeDefined()
		expect(expenses).toBeDefined()
		expect(savingsGoals).toBeDefined()
		expect(balanceTracking).toBeDefined()
		expect(userProfiles).toBeDefined()
	})

	it('should have profileId reference userProfiles table', () => {
		expect(userProfiles).toBeDefined()
		expect(incomeSources).toBeDefined()
	})
})

describe('Enum Values', () => {
	it('subscriptionStatusEnum should have correct values', () => {
		const enumValues = subscriptionStatusEnum.enumValues
		expect(enumValues).toContain('free')
		expect(enumValues).toContain('active')
		expect(enumValues).toContain('past_due')
		expect(enumValues).toContain('canceled')
		expect(enumValues).not.toContain('cancelled')
		expect(enumValues).not.toContain('unpaid')
	})

	it('currencyEnum should have common currencies', () => {
		const enumValues = currencyEnum.enumValues
		expect(enumValues).toContain('NONE')
		expect(enumValues).toContain('USD')
		expect(enumValues).toContain('EUR')
		expect(enumValues).toContain('GBP')
		expect(enumValues).toContain('JPY')
		expect(enumValues).toContain('CAD')
		expect(enumValues).toContain('AUD')
		expect(enumValues).toContain('CHF')
		expect(enumValues).toContain('CNY')
		expect(enumValues).toContain('SEK')
		expect(enumValues).toContain('NZD')
		expect(enumValues).toContain('INR')
		expect(enumValues).toContain('BRL')
		expect(enumValues).toContain('MXN')
		expect(enumValues).toContain('KRW')
		expect(enumValues).toContain('SGD')
		expect(enumValues).toContain('HKD')
		expect(enumValues).toContain('NOK')
		expect(enumValues).toContain('DKK')
		expect(enumValues).toContain('PLN')
		expect(enumValues).toContain('TRY')
	})
})

describe('Soft-delete (isDeleted) columns', () => {
	it('users already has an isDeleted column', () => {
		expect(users.isDeleted).toBeDefined()
	})

	it('all syncable entity tables expose an isDeleted column', () => {
		expect(incomeSources.isDeleted).toBeDefined()
		expect(expenses.isDeleted).toBeDefined()
		expect(savingsGoals.isDeleted).toBeDefined()
		expect(balanceTracking.isDeleted).toBeDefined()
		expect(userProfiles.isDeleted).toBeDefined()
	})

	it('isDeleted defaults to false and is not null', () => {
		expect(incomeSources.isDeleted.notNull).toBe(true)
		expect(incomeSources.isDeleted.default).toBe(false)
		expect(userProfiles.isDeleted.notNull).toBe(true)
		expect(userProfiles.isDeleted.default).toBe(false)
	})
})

describe('Entity primary keys are client-generatable uuids', () => {
	it('all four syncable entity tables expose a uuid id column', () => {
		expect(incomeSources.id.getSQLType()).toBe('uuid')
		expect(expenses.id.getSQLType()).toBe('uuid')
		expect(savingsGoals.id.getSQLType()).toBe('uuid')
		expect(balanceTracking.id.getSQLType()).toBe('uuid')
	})

	it('userProfiles (already uuid) and these entity ids are the same kind', () => {
		expect(userProfiles.id.getSQLType()).toBe('uuid')
		expect(incomeSources.id.dataType).toBe('string')
	})

	it('entity ids carry a DB default so server-originated inserts need no client id', () => {
		expect(incomeSources.id.hasDefault).toBe(true)
		expect(expenses.id.hasDefault).toBe(true)
		expect(savingsGoals.id.hasDefault).toBe(true)
		expect(balanceTracking.id.hasDefault).toBe(true)
	})
})

describe('Categories table', () => {
	it('is exported and registered in allTables', () => {
		expect(categories).toBeDefined()
		expect(categoryKindEnum).toBeDefined()
		expect(allTables.categories).toBe(categories)
	})

	it('follows the syncable-entity conventions: uuid PK with a default, and a tombstone', () => {
		expect(categories.id.getSQLType()).toBe('uuid')
		expect(categories.id.dataType).toBe('string')
		expect(categories.id.hasDefault).toBe(true)
		expect(categories.isDeleted.notNull).toBe(true)
		expect(categories.isDeleted.default).toBe(false)
	})

	it('is scoped to a user AND a profile, both required', () => {
		expect(categories.userId.getSQLType()).toBe('uuid')
		expect(categories.userId.notNull).toBe(true)
		expect(categories.profileId.getSQLType()).toBe('uuid')
		expect(categories.profileId.notNull).toBe(true)
	})

	it('carries a required kind separating the income and expense namespaces', () => {
		expect(categories.kind.notNull).toBe(true)
		expect(categoryKindEnum.enumValues).toEqual(['income', 'expense'])
		const incomeKind: CategoryKind = 'income'
		const expenseKind: CategoryKind = 'expense'
		expect([incomeKind, expenseKind]).toEqual(categoryKindEnum.enumValues)
	})

	it('financeType carries all three balance categories, and FinanceType tracks it', () => {
		expect(financeTypeEnum.enumValues).toEqual(['investment', 'debt', 'asset'])

		const investment: FinanceType = 'investment'
		const debt: FinanceType = 'debt'
		const asset: FinanceType = 'asset'
		expect([investment, debt, asset]).toEqual(financeTypeEnum.enumValues)

		expect(ALL_FINANCE_TYPES).toEqual(financeTypeEnum.enumValues)
	})

	it('balanceTracking.type is NOT NULL and carries no default', () => {
		// No default, so widening the enum can't silently re-type an existing row.
		expect(balanceTracking.type.notNull).toBe(true)
		expect(balanceTracking.type.hasDefault).toBe(false)
	})

	it('balanceTracking.contributionRecordedAsExpense is NOT NULL and defaults false', () => {
		// `false` keeps every existing row's pool arithmetic; only an explicitly ticked row changes.
		expect(balanceTracking.contributionRecordedAsExpense).toBeDefined()
		expect(balanceTracking.contributionRecordedAsExpense.getSQLType()).toBe('boolean')
		expect(balanceTracking.contributionRecordedAsExpense.notNull).toBe(true)
		expect(balanceTracking.contributionRecordedAsExpense.hasDefault).toBe(true)
		expect(balanceTracking.contributionRecordedAsExpense.default).toBe(false)
	})

	it('expenses.endsBeforeRetirement is NOT NULL and defaults false', () => {
		// `false` makes a row created outside the app's push path default to counted.
		expect(expenses.endsBeforeRetirement).toBeDefined()
		expect(expenses.endsBeforeRetirement.getSQLType()).toBe('boolean')
		expect(expenses.endsBeforeRetirement.notNull).toBe(true)
		expect(expenses.endsBeforeRetirement.hasDefault).toBe(true)
		expect(expenses.endsBeforeRetirement.default).toBe(false)
	})

	it('⚠️ endsBeforeRetirement is on expenses ONLY, never on incomeSources', () => {
		// `updateEntity` spreads `operation.data` into `.set()` with no column whitelist, so payload
		// arms are split by entity.
		expect('endsBeforeRetirement' in incomeSources).toBe(false)
	})

	it('categoryId is NULLABLE on both cashflow tables so uncategorized stays valid', () => {
		// Nullable, so existing rows survive the migration and no form gains a required field.
		expect(incomeSources.categoryId.getSQLType()).toBe('uuid')
		expect(incomeSources.categoryId.notNull).toBe(false)
		expect(expenses.categoryId.getSQLType()).toBe('uuid')
		expect(expenses.categoryId.notNull).toBe(false)
	})

	/** Shape assertions stayed green with these FKs deleted, so assert the FKs directly. */
	it('categoryId is a REAL foreign key to categories on both cashflow tables', () => {
		const incomeFks = getTableConfig(incomeSources).foreignKeys.map((fk) => fk.reference())
		const expenseFks = getTableConfig(expenses).foreignKeys.map((fk) => fk.reference())

		const referencesCategories = (
			refs: ReturnType<ReturnType<typeof getTableConfig>['foreignKeys'][number]['reference']>[]
		) =>
			refs.some(
				(ref) =>
					ref.columns.some((column) => column.name === 'categoryId') &&
					ref.foreignColumns.some((column) => getTableName(column.table) === 'categories')
			)

		expect(referencesCategories(incomeFks), 'incomeSources.categoryId has no FK').toBe(true)
		expect(referencesCategories(expenseFks), 'expenses.categoryId has no FK').toBe(true)
	})

	it('categories itself references users and userProfiles', () => {
		const refs = getTableConfig(categories).foreignKeys.map((fk) => fk.reference())
		const targets = refs.map((ref) => getTableName(ref.foreignColumns[0].table)).sort()

		// An orphaned category is unreachable data that account and profile deletion would miss.
		expect(targets).toEqual(['userProfiles', 'users'])
	})

	it('the live-name unique index is PARTIAL and case-insensitive', () => {
		const { indexes } = getTableConfig(categories)
		const liveNameIndex = indexes.find(
			(index) => index.config.name === 'categories_userId_profileId_kind_name_live_unique'
		)

		expect(liveNameIndex, 'the live-name unique index is missing').toBeDefined()
		expect(liveNameIndex?.config.unique).toBe(true)

		// Without the predicate, re-creating a deleted category collides with its own tombstone.
		expect(liveNameIndex?.config.where).toBeDefined()

		// Must be case-insensitive to agree with the client's `normalizeName`. Drizzle objects are
		// circular, so walk the string chunks rather than serializing.
		const stringChunks = (node: unknown, out: string[] = []): string[] => {
			if (typeof node === 'string') {
				out.push(node)
				return out
			}
			if (!node || typeof node !== 'object') {
				return out
			}
			// A `StringChunk` keeps its literal text in a `value` array.
			const value = (node as { value?: unknown }).value
			if (Array.isArray(value)) {
				out.push(...value.filter((entry): entry is string => typeof entry === 'string'))
			}
			const chunks = (node as { queryChunks?: unknown[] }).queryChunks
			if (Array.isArray(chunks)) {
				for (const chunk of chunks) {
					stringChunks(chunk, out)
				}
			}
			return out
		}

		const indexedExpressions = (liveNameIndex?.config.columns ?? []).flatMap((column) =>
			stringChunks(column)
		)
		expect(indexedExpressions.join(' ')).toContain('lower')
	})
})

describe('sortOrder — explicit display order', () => {
	const ORDERED_TABLES = [
		['incomeSources', incomeSources],
		['expenses', expenses],
		['savingsGoals', savingsGoals],
		['balanceTracking', balanceTracking],
	] as const

	it.each(ORDERED_TABLES)('%s.sortOrder is an integer, NOT NULL, DEFAULT 0', (_name, table) => {
		// Integer, not a float/numeric: positions are counted, never interpolated.
		expect(table.sortOrder.getSQLType()).toBe('integer')
		// NOT NULL + a default makes the migration safe on a populated table.
		expect(table.sortOrder.notNull).toBe(true)
		expect(table.sortOrder.hasDefault).toBe(true)
		expect(table.sortOrder.default).toBe(0)
	})

	// Duplicate sortOrder is expected under two-device LWW; a unique index would fail the losing
	// insert at the database. Reads converge through a tiebreaker instead.
	it.each(ORDERED_TABLES)('%s has NO uniqueness constraint touching sortOrder', (_name, table) => {
		const config = getTableConfig(table)

		const uniqueIndexColumns = config.indexes
			.filter((index) => index.config.unique)
			.flatMap((index) => index.config.columns)
			.map((column) => (column as { name?: string }).name)
		expect(uniqueIndexColumns).not.toContain('sortOrder')

		const uniqueConstraintColumns = config.uniqueConstraints.flatMap((constraint) =>
			constraint.columns.map((column) => column.name)
		)
		expect(uniqueConstraintColumns).not.toContain('sortOrder')

		// The column-level shorthand is a third, independent way to get uniqueness.
		expect(table.sortOrder.isUnique).toBeFalsy()
	})
})

// The only place pinning this table's exact column set. Exact sets, not absence checks: an
// absence check on an already-gone column can never fail.
describe('balanceTracking — the contribution limit is removed', () => {
	it('has exactly the expected columns, and maxContributionLimit is not among them', () => {
		const columns = getTableConfig(balanceTracking)
			.columns.map((column) => column.name)
			.sort()

		expect(columns).toEqual(
			[
				'contributionRecordedAsExpense',
				'createdAt',
				'currentBalance',
				'frequency',
				'id',
				'isDeleted',
				'monthlyContribution',
				'name',
				'paymentExpenseId',
				'profileId',
				'sortOrder',
				'type',
				'updatedAt',
				'userId',
			].sort()
		)
	})

	it('declares exactly one CHECK constraint, the monthlyContribution bound', () => {
		// Declaration only; the replay and check-constraint tests cover the database and behaviour.
		const checkNames = getTableConfig(balanceTracking)
			.checks.map((check) => check.name)
			.sort()

		expect(checkNames).toEqual(['balanceTracking_monthlyContribution_non_negative'])
	})
})

// No foreign key on purpose: a dangling link is normal, and an FK would turn it into a 23503
// on push that replays until the circuit breaker stops all sync.
describe('balanceTracking.paymentExpenseId', () => {
	it('is a nullable uuid with no default', () => {
		const column = balanceTracking.paymentExpenseId
		expect(column.getSQLType()).toBe('uuid')
		expect(column.notNull).toBe(false)
		expect(column.hasDefault).toBe(false)
	})

	it('⚠️ references NOTHING: the table keeps exactly its two owner FKs', () => {
		const refs = getTableConfig(balanceTracking)
			.foreignKeys.map((fk) => {
				const ref = fk.reference()
				return `${ref.columns.map((c) => c.name).join(',')}->${
					getTableConfig(ref.foreignTable).name
				}`
			})
			.sort()
		expect(refs).toEqual(['profileId->userProfiles', 'userId->users'])
	})
})
