/**
 * Stores call the syncEntity* helpers; with no registered paid session they are no-ops (free tier makes no requests).
 * One-way dependency: never import stores (import cycle) or server code here.
 */

import type { SyncEntityType, SyncOperation } from '@budget-planner/core/sync/types'
import { RETIREMENT_PLAN_STRING_MAX } from '@budget-planner/core/sync/types'
import { z } from 'zod'
import { coerceRetirementPlan, type RetirementPlan } from '../retirement-plan'

/**
 * The push schema refuses over-long strings, NULs and lone surrogates, which would block every push of the plan.
 * Drop NULs, replace lone surrogates, and cut without splitting a pair.
 */
function sanitizePlanString(value: string): string {
	let clean = value
		.replaceAll('\u0000', '')
		.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
	if (clean.length > RETIREMENT_PLAN_STRING_MAX) {
		clean = clean.slice(0, RETIREMENT_PLAN_STRING_MAX)
		if (/[\ud800-\udbff]$/.test(clean)) {
			clean = clean.slice(0, -1)
		}
	}
	return clean
}

function sanitizePlanStrings(plan: RetirementPlan): RetirementPlan {
	const clean: Record<string, unknown> = { ...plan }
	for (const [key, value] of Object.entries(clean)) {
		if (typeof value === 'string') {
			clean[key] = sanitizePlanString(value)
		}
	}
	return clean as unknown as RetirementPlan
}

export type SyncBridgeHandle = {
	userId: string
	queueCreate: (
		entityType: SyncEntityType,
		entityId: string,
		data: Record<string, unknown>
	) => Promise<void>
	queueUpdate: (
		entityType: SyncEntityType,
		entityId: string,
		data: Record<string, unknown>,
		version?: number,
		baseVersion?: number,
		dependsOn?: SyncOperation['dependsOn']
	) => Promise<void>
	queueDelete: (entityType: SyncEntityType, entityId: string, baseVersion?: number) => Promise<void>
}

let handle: SyncBridgeHandle | null = null

export function registerSyncBridge(next: SyncBridgeHandle): void {
	handle = next
}

export function clearSyncBridge(): void {
	handle = null
}

export function isSyncActive(): boolean {
	return handle !== null
}

export function getSyncSessionUserId(): string | null {
	return handle === null ? null : handle.userId
}

// Not intersected with Record<string, unknown>: store item interfaces have no index signature.
type ClientEntity = { id: string; updatedAt?: string }

const UUID_SCHEMA = z.string().uuid()

function toBaseVersion(updatedAt: unknown): number | undefined {
	if (typeof updatedAt !== 'string') {
		return undefined
	}
	const ms = Date.parse(updatedAt)
	return Number.isNaN(ms) ? undefined : ms
}

/**
 * Split per entity so a payload never declares a field its entity lacks: drizzle drops it silently today,
 * but a future .strict() server schema would reject all income sync.
 */
function cashflowPayload(entity: Record<string, unknown>, userId: string): Record<string, unknown> {
	return {
		name: entity['name'],
		amount: entity['amount'],
		frequency: entity['frequency'],
		// Pinned to null until category sync works: a real category uuid fails the FK and opens the circuit breaker.
		// Explicit null, not omitted: updateEntity is a partial .set().
		categoryId: null,
		// Always emitted: updateEntity is a partial .set(), so an omitted key never lands.
		sortOrder: entity['sortOrder'],
		userId,
	}
}

/** The payload carries the session uuid, not the local placeholder; the local row is stamped only once the server accepts. */
export function toServerPayload(
	entityType: SyncEntityType,
	entityIn: ClientEntity,
	userId: string
): Record<string, unknown> {
	const entity = entityIn as Record<string, unknown>
	switch (entityType) {
		case 'incomeSource':
			return cashflowPayload(entity, userId)
		case 'expense':
			return {
				...cashflowPayload(entity, userId),
				// Always emitted (partial .set()); `=== true` because a persisted "false" string is truthy and fails the queue gate.
				endsBeforeRetirement: entity['endsBeforeRetirement'] === true,
			}
		case 'savingsGoal':
			return {
				name: entity['name'],
				targetAmount: entity['targetAmount'],
				currentBalance: entity['currentBalance'],
				// Forwarded, else sync drops it and the server defaults every account.
				allocationMode: entity['allocationMode'] ?? 'automatic',
				// Always forwarded, including null: switching manual→automatic must reset it (partial .set()).
				monthlyAllocation: entity['monthlyAllocation'] ?? null,
				// Always emitted: updateEntity is a partial .set(), so an omitted key never lands.
				sortOrder: entity['sortOrder'],
				userId,
			}
		case 'balanceTracking': {
			const payload: Record<string, unknown> = {
				type: entity['type'],
				name: entity['name'],
				currentBalance: entity['currentBalance'],
				monthlyContribution: entity['monthlyContribution'] ?? 0,
				// `?? false` keeps the key on the wire; a partial .set() would keep the old value.
				contributionRecordedAsExpense: entity['contributionRecordedAsExpense'] ?? false,
				// Always emitted, null when unlinked (partial .set()). A non-uuid becomes null, or the queue gate drops the whole op.
				paymentExpenseId: UUID_SCHEMA.safeParse(entity['paymentExpenseId']).success
					? entity['paymentExpenseId']
					: null,
				// Forwarded, else the server defaults every synced entry to 'monthly'.
				frequency: entity['frequency'] ?? 'monthly',
				// Always emitted: updateEntity is a partial .set(), so an omitted key never lands.
				sortOrder: entity['sortOrder'],
				userId,
			}
			return payload
		}
		case 'category':
			return {
				name: entity['name'],
				kind: entity['kind'],
				userId,
			}
		case 'userProfile': {
			const payload: Record<string, unknown> = {
				name: entity['name'],
				isDefault: entity['isDefault'] ?? false,
				currency: entity['currency'] ?? 'NONE',
				userId,
			}
			if (entity['description'] != null) {
				payload['description'] = entity['description']
			}
			// Omitted when unset, unlike sortOrder: no UI clears an icon, and a partial .set() leaves the server value.
			if (entity['icon'] != null) {
				payload['icon'] = entity['icon']
			}
			return payload
		}
		case 'retirementPlan':
			// The whole plan every time, coerced so cleared '' and null survive JSON.stringify where undefined would drop.
			return { plan: sanitizePlanStrings(coerceRetirementPlan(entity['plan'])), userId }
		default: {
			// `never` makes a new entity type a compile error here instead of falling through to another shape.
			const exhaustive: never = entityType
			throw new Error(`toServerPayload: unhandled sync entity type ${String(exhaustive)}`)
		}
	}
}

/** A sync hiccup must not break the local edit. */
function onQueueError(action: string, error: unknown): void {
	console.error(`[syncBridge] failed to queue ${action}:`, error)
}

export function syncEntityCreate(entityType: SyncEntityType, entity: ClientEntity): void {
	const queued = enqueueCreate(entityType, entity)
	if (queued) {
		queued.catch((error) => onQueueError(`create ${entityType}`, error))
	}
}

/** Doesn't swallow rejections: the seeder awaits durable adds before marking seeded. */
export function enqueueCreate(
	entityType: SyncEntityType,
	entity: ClientEntity
): Promise<void> | null {
	if (!handle) {
		return null
	}
	const payload = toServerPayload(entityType, entity, handle.userId)
	return handle.queueCreate(entityType, entity.id, payload)
}

/** `previous.updatedAt` becomes baseVersion for causal LWW. If a pull drops the `dependsOn` op, this one is dropped too. */
export function syncEntityUpdate(
	entityType: SyncEntityType,
	entity: ClientEntity,
	previous?: ClientEntity,
	options: { dependsOn?: SyncOperation['dependsOn'] } = {}
): void {
	const queued = enqueueUpdate(entityType, entity, previous, options)
	if (queued) {
		queued.catch((error) => onQueueError(`update ${entityType}`, error))
	}
}

export function enqueueUpdate(
	entityType: SyncEntityType,
	entity: ClientEntity,
	previous?: ClientEntity,
	options: { dependsOn?: SyncOperation['dependsOn'] } = {}
): Promise<void> | null {
	if (!handle) {
		return null
	}
	const payload = toServerPayload(entityType, entity, handle.userId)
	const baseVersion = toBaseVersion(previous?.updatedAt ?? entity.updatedAt)
	return handle.queueUpdate(
		entityType,
		entity.id,
		payload,
		undefined,
		baseVersion,
		options.dependsOn
	)
}

export function syncEntityDelete(entityType: SyncEntityType, entity: ClientEntity): void {
	if (!handle) {
		return
	}
	const baseVersion = toBaseVersion(entity.updatedAt)
	handle.queueDelete(entityType, entity.id, baseVersion).catch((error) => {
		onQueueError(`delete ${entityType}`, error)
	})
}
