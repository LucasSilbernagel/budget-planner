import { z } from 'zod'
import { MAX_MONEY_CENTS } from '../finance/money-limits'
import { INCOME_BASES, RETIREMENT_MODELS } from '../finance/retirement'
import { FINANCE_TYPES } from '../services/balanceTracking'

// Money is stored as int32 cents; refuse what the DB can't store before it queues and retries forever.
// Import PG_INT32_MAX rather than re-declaring the literal, so producers can't drift from the gate.
export const PG_INT32_MAX = 2_147_483_647
const PG_INT32_MIN = -2_147_483_648

// Must mirror `currencyEnum` in the db schema exactly: a missing value locks that user out of sync.
// Duplicated because core can't depend on db; a parity test pins it.
export const SYNC_CURRENCIES = [
	'NONE',
	'USD',
	'EUR',
	'GBP',
	'JPY',
	'CAD',
	'AUD',
	'CHF',
	'CNY',
	'SEK',
	'NZD',
	'INR',
	'BRL',
	'MXN',
	'KRW',
	'SGD',
	'HKD',
	'NOK',
	'DKK',
	'PLN',
	'TRY',
] as const

// Pull-path gates for whole rows: required iff the column is NOT NULL, `.nullable()` iff nullable,
// never `.default()`. A false rejection here silently refuses the user's own data.
export const incomeSourceSchema = z.object({
	name: z.string().min(1).max(255),
	amount: z.number().int(),
	frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
	userId: z.string().uuid(),
})

export const expenseSchema = z.object({
	name: z.string().min(1).max(255),
	amount: z.number().int(),
	frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
	endsBeforeRetirement: z.boolean(),
	userId: z.string().uuid(),
})

export const categorySchema = z.object({
	name: z.string().min(1).max(255),
	kind: z.enum(['income', 'expense']),
	userId: z.string().uuid(),
})

export const savingsGoalSchema = z.object({
	name: z.string().min(1).max(255),
	// Nullable: null means a savings account with no target.
	targetAmount: z.number().int().positive().max(MAX_MONEY_CENTS).nullable(),
	// `.min(0)` mirrors a DB constraint. Deliberately not mirrored onto balanceTracking, where any
	// refusal past the client store would deadlock sync or drop the row.
	currentBalance: z.number().int().min(0).max(MAX_MONEY_CENTS),
	// `allocationMode` is optional here; the server gate defaults it on ingest.
	monthlyAllocation: z.number().int().min(0).max(MAX_MONEY_CENTS).nullable().optional(),
	allocationMode: z.enum(['manual', 'automatic']),
	userId: z.string().uuid(),
})

export const balanceTrackingSchema = z.object({
	type: z.enum(FINANCE_TYPES),
	name: z.string().min(1).max(255),
	// May be negative (debt balances).
	currentBalance: z.number().int().min(PG_INT32_MIN).max(MAX_MONEY_CENTS),
	monthlyContribution: z.number().int().min(0).max(MAX_MONEY_CENTS),
	frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']),
	// The contribution is already recorded as an expense, so the savings pool must not subtract it twice.
	contributionRecordedAsExpense: z.boolean(),
	// `paymentExpenseId` is deliberately undeclared: this gate is verdict-only, so the key still reaches
	// the store, and declaring it could only add false rejections.
	userId: z.string().uuid(),
})

export const userProfileSchema = z.object({
	name: z.string().min(1).max(255),
	// `.optional()` alone rejects the explicit null a pulled row carries. The push gate never sees
	// null (the bridge omits it), so it legitimately differs.
	description: z.string().max(500).nullable().optional(),
	isDefault: z.boolean(),
	// Nullable column; `.default()` would not do, since it substitutes for undefined only.
	currency: z.enum(SYNC_CURRENCIES).nullable(),
	icon: z.string().max(16).nullable().optional(),
	userId: z.string().uuid(),
})

/** Real values are a few characters; the bound only stops a pathological payload. */
export const RETIREMENT_PLAN_STRING_MAX = 255

// Strings jsonb refuses (NUL, lone surrogate) fail with a non-permanent SQLSTATE and would
// replay forever, so refuse them before they queue.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

function isJsonbStorableString(value: string): boolean {
	return !value.includes('\u0000') && !LONE_SURROGATE.test(value)
}

const retirementPlanString = z
	.string()
	.max(RETIREMENT_PLAN_STRING_MAX)
	.refine(isJsonbStorableString, {
		message: 'contains a character the server cannot store',
	})

/** The largest value whose ×12 is still a safe integer. */
export const RETIREMENT_ADOPTED_CENTS_MAX = Math.floor(Number.MAX_SAFE_INTEGER / 12)

// Every field required: the whole plan is written to one jsonb column. This nested object strips
// undeclared keys, so a test pins its keys to the plan defaults.
export const retirementPlanSyncSchema = z.object({
	currentAgeInput: retirementPlanString,
	lifeExpectancyInput: retirementPlanString,
	desiredIncomeInput: retirementPlanString,
	desiredIncomeTouched: z.boolean(),
	desiredIncomeLocale: retirementPlanString,
	// `null` means never adopted.
	adoptedMonthlyCents: z.number().int().min(0).max(RETIREMENT_ADOPTED_CENTS_MAX).nullable(),
	incomeBasis: z.enum(INCOME_BASES),
	annualReturnInput: retirementPlanString,
	postRetirementReturnInput: retirementPlanString,
	postRetirementTouched: z.boolean(),
	model: z.enum(RETIREMENT_MODELS),
})

// Deliberately lenient: the web applier coerces every field, so a strict gate would refuse a
// newer client's whole plan over one unknown field.
const retirementPlanRowSchema = z.object({
	plan: z.record(z.unknown()),
	userId: z.string().uuid(),
})

// Strips undeclared keys before queueing, so a field missing here silently never syncs. Keep bounds
// strict: a DB rejection on push replays until the circuit breaker stops all sync.
export const syncOperationDataSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	amount: z.number().int().positive().max(MAX_MONEY_CENTS).optional(),
	frequency: z.enum(['weekly', 'biweekly', 'monthly', 'annually']).optional(),
	// Must allow null (a savings account without a target).
	targetAmount: z.number().int().positive().max(MAX_MONEY_CENTS).nullable().optional(),
	currentBalance: z.number().int().min(PG_INT32_MIN).max(MAX_MONEY_CENTS).optional(),
	type: z.enum(FINANCE_TYPES).optional(),
	monthlyContribution: z.number().int().min(0).max(MAX_MONEY_CENTS).optional(),
	contributionRecordedAsExpense: z.boolean().optional(),
	// Nullable: unlinking sends an explicit null. A uuid matching no expense is valid (no FK).
	paymentExpenseId: z.string().uuid().nullable().optional(),
	endsBeforeRetirement: z.boolean().optional(),
	monthlyAllocation: z.number().int().min(0).max(MAX_MONEY_CENTS).nullable().optional(),
	allocationMode: z.enum(['manual', 'automatic']).optional(),
	description: z.string().max(500).optional(),
	isDefault: z.boolean().optional(),
	// Nullable: clearing a category sends an explicit null, since updates are partial `.set()`s.
	kind: z.enum(['income', 'expense']).optional(),
	categoryId: z.string().uuid().nullable().optional(),
	sortOrder: z.number().int().min(0).max(PG_INT32_MAX).optional(),
	currency: z.enum(SYNC_CURRENCIES).optional(),
	icon: z.string().max(16).nullable().optional(),
	// Required for a plan op by the per-entity refinement.
	plan: retirementPlanSyncSchema.optional(),
	userId: z.string().uuid().optional(),
})

export type SyncEntityType =
	| 'incomeSource'
	| 'expense'
	| 'savingsGoal'
	| 'balanceTracking'
	| 'userProfile'
	// Only compile-checked against SERVER_ROW_SCHEMAS and the web ENTITY_BINDINGS; every other
	// sync gate must be updated by hand and fails silently if missed.
	| 'category'
	| 'retirementPlan'

export type SyncOperationType = 'create' | 'update' | 'delete'

export type SyncOperation = {
	id: string

	type: SyncOperationType

	entityType: SyncEntityType

	entityId: string

	data: Record<string, unknown>

	timestamp: number

	deviceId: string

	userId: string

	profileId?: string

	version?: number

	// Server `updatedAt` this op was based on, so pull LWW compares causally instead of trusting
	// skewed wall clocks. Absent falls back to `timestamp`.
	baseVersion?: number

	// One-way: a dropped target drops this op, not vice versa. On push this op is held until its
	// target lands, else a promotion makes the server bump the profile being deleted.
	dependsOn?: {
		entityType: SyncEntityType
		entityId: string
		type: SyncOperationType
	}
}

// Built from an entity row, not an op, so it has no deviceId; pull uses state-based LWW on `updatedAt`.
export type ServerChange = {
	entityType: SyncEntityType

	entityId: string

	data: Record<string, unknown>

	updatedAt: number

	isDeleted: boolean
}

export const SERVER_ROW_SCHEMAS: Record<SyncEntityType, z.ZodTypeAny> = {
	incomeSource: incomeSourceSchema,
	expense: expenseSchema,
	savingsGoal: savingsGoalSchema,
	balanceTracking: balanceTrackingSchema,
	userProfile: userProfileSchema,
	category: categorySchema,
	// Lenient on purpose: see `retirementPlanRowSchema`.
	retirementPlan: retirementPlanRowSchema,
}

/** `fields` is `path:code`, never a value. */
export type ServerRowVerdict = { ok: true } | { ok: false; fields: string[] }

// Verdict only: callers keep the original change, since `z.object` strips undeclared keys.
// Issue messages can embed money values, so only path and code leave here.
export function validateServerRow(change: ServerChange): ServerRowVerdict {
	// Own-property check: `entityType` comes from the server, and inherited keys like `toString`
	// would otherwise match.
	if (!Object.hasOwn(SERVER_ROW_SCHEMAS, change.entityType)) {
		return { ok: true }
	}
	const schema = SERVER_ROW_SCHEMAS[change.entityType]
	const result = schema.safeParse(change.data)
	if (result.success) {
		return { ok: true }
	}
	return {
		ok: false,
		fields: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`),
	}
}

/** A refused pulled row. It carries no data or zod issues, so no value can leak through it. */
export type RefusedServerChange = {
	entityType: SyncEntityType
	entityId: string
	fields: string[]
}

export type ServerChangesRefusedCallback = (refused: RefusedServerChange[]) => void

/** `since` is the pull cursor; `null` requests a full snapshot. */
export type FetchServerChangesFn = (since: number | null) => Promise<ServerChange[]>

export type ChangesPulledCallback = (changes: ServerChange[]) => void

/** Fired once per sync; never with an op whose queue removal failed (it will be re-sent). */
export type OperationsRejectedCallback = (operations: SyncOperation[]) => void

/** Includes an accepted op whose queue removal failed; never fired by a destroyed service. */
export type OperationsSyncedCallback = (operations: SyncOperation[]) => void

export type PullResult = {
	success: boolean

	changesPulledCount: number

	applied: ServerChange[]

	/** Server changes suppressed because a newer queued local edit won LWW. */
	conflicts: ServerChange[]

	/** Failed their entity schema: not applied, displaced nothing, and the cursor still advances. */
	refused: RefusedServerChange[]

	/** Ops dropped because this pull applied their profile's tombstone. */
	discardedForDeletedProfile: SyncOperation[]

	/** Ops dropped because their `dependsOn` target lost LWW; the host must revert them locally. */
	droppedDependents: SyncOperation[]

	error?: string

	lastPullTimestamp: number | null
}

export enum SyncStatus {
	PENDING = 'PENDING',
	IN_PROGRESS = 'IN_PROGRESS',
	COMPLETED = 'COMPLETED',
	FAILED = 'FAILED',
	CONFLICT = 'CONFLICT',
	PARTIAL = 'PARTIAL',
	OFFLINE = 'OFFLINE',
}

export type SyncState = {
	status: SyncStatus

	lastSyncTimestamp: number | null

	// Separate from the push cursor: a push must not advance it, or remote changes would be skipped.
	lastPullTimestamp: number | null

	pendingOperations: SyncOperation[]

	/** A view of `pendingOperations`: ops that failed retryably last sync. Never the only copy. */
	failedOperations: SyncOperation[]

	// A view of `pendingOperations`: ops that failed too many attempts in a row. They stay queued;
	// counts live in memory, so a reload resets them.
	escalatedOperations: SyncOperation[]

	conflictOperations: SyncOperation[]

	// Bounded diagnostic record, not how the user is told. 401/403 and failures without a status
	// proving permanence stay queued instead.
	rejectedOperations: SyncOperation[]

	isOnline: boolean

	lastError?: string

	retryCount: number
}

export type ConflictResult = {
	hasConflict: boolean

	conflictType?: ConflictType

	localOperation?: SyncOperation

	serverOperation?: SyncOperation

	resolution?: SyncOperation
}

export type ConflictType =
	| 'create-create'
	| 'create-update'
	| 'create-delete'
	| 'update-create'
	| 'update-update'
	| 'update-delete'
	| 'delete-create'
	| 'delete-update'
	| 'delete-delete'
	| 'version-mismatch'

export type ConflictResolutionStrategy =
	| 'last-write-wins'
	| 'server-wins'
	| 'client-wins'
	| 'manual'
	| 'merge'

export type ProcessOperationResult = {
	success: boolean
	conflict?: boolean
	error?: string
	/** Omitted means retryable, for backwards compatibility. */
	retryable?: boolean
	statusCode?: number
}

export type ProcessOperationFn = (operation: SyncOperation) => Promise<ProcessOperationResult>

export type SyncConfig = {
	conflictResolutionStrategy: ConflictResolutionStrategy

	maxRetries: number

	retryDelay: number

	batchSize: number

	autoSync: boolean

	autoSyncInterval: number

	debug: boolean

	processOperation?: ProcessOperationFn

	/** If absent, `pull()` fails loud so a misconfiguration can't pass as "no remote changes". */
	fetchServerChanges?: FetchServerChangesFn

	pullInterval?: number

	profileId?: string
}

export type SyncResult = {
	success: boolean

	synchronizedCount: number

	failedCount: number

	conflictCount: number

	state: SyncState

	error?: string

	duration: number
}

export type SyncStatusCallback = (state: SyncState) => void

export type ConflictCallback = (conflict: ConflictResult) => void

export type SyncQueueStorage = {
	loadQueue: (userId: string) => Promise<SyncOperation[]>

	saveQueue: (userId: string, queue: SyncOperation[]) => Promise<void>

	clearQueue: (userId: string) => Promise<void>
}
