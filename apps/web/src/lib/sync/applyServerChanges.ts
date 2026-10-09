/** Rows are validated in core's pull before last-writer-wins, so there is deliberately no second validator here. */

import type {
	RefusedServerChange,
	ServerChange,
	SyncEntityType,
	SyncOperation,
} from '@budget-planner/core/sync/types'
import { useBalanceStore } from '../../stores/balanceStore'
import { useCategoryStore } from '../../stores/categoryStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useIncomeStore } from '../../stores/incomeStore'
import { useProfileStore } from '../../stores/profileStore'
import {
	claimRetirementPlanFor,
	coerceRetirementPlan,
	useRetirementPlannerStore,
} from '../../stores/retirementPlannerStore'
import { useSavingsStore } from '../../stores/savingsStore'
import { stampMissingSortOrder } from '../ordering'
import { cascadeProfileRowRemoval } from '../profile-cascade'
import { isOwnedByAnotherAccount, isPlaceholderOwner } from './accountOwner'
import {
	classifyPulledPlan,
	notePlanOpsAccepted,
	notePlanSynced,
	requeueAfterOwnEcho,
} from './retirementPlanPush'

type StoreApi = {
	getState: () => Record<string, unknown>
	setState: (partial: Record<string, unknown>) => void
}

type CollectionBinding = {
	kind: 'collection'
	store: StoreApi
	collection: string
}

type ApplyContext = {
	sessionUserId: string
	hasPendingOperation?: (entityType: SyncEntityType, entityId: string) => boolean
}

type SingletonBinding = {
	kind: 'singleton'
	read: (id: string) => Record<string, unknown> | undefined
	apply: (change: ServerChange, context: ApplyContext) => boolean
}

type EntityBinding = CollectionBinding | SingletonBinding

/**
 * A tombstone is a no-op. Every skip still records the change's version as serverUpdatedAt, or the next push is dropped.
 * The object check matters because coerceRetirementPlan turns a non-object into the defaults.
 */
function applyRetirementPlanChange(change: ServerChange, context: ApplyContext): boolean {
	if (change.isDeleted) {
		return false
	}
	if (change.entityId !== context.sessionUserId) {
		reportRefusedRow(change.entityType, change.entityId, ['entityId:not_the_session_account'])
		return false
	}
	const plan = change.data['plan']
	if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
		reportRefusedRow(change.entityType, change.entityId, ['plan:invalid_type'])
		return false
	}
	const pulled = coerceRetirementPlan(plan)
	const queued = context.hasPendingOperation?.('retirementPlan', change.entityId) === true
	const verdict = queued ? 'skip' : classifyPulledPlan(context.sessionUserId, pulled)
	if (verdict !== 'apply') {
		const store = useRetirementPlannerStore.getState()
		if (store.ownerUserId === context.sessionUserId) {
			const seen = store.serverUpdatedAt === null ? Number.NaN : Date.parse(store.serverUpdatedAt)
			if (!(seen >= change.updatedAt)) {
				useRetirementPlannerStore.setState({
					serverUpdatedAt: new Date(change.updatedAt).toISOString(),
				})
			}
		}
		if (verdict === 'own-echo') {
			requeueAfterOwnEcho(context.sessionUserId)
		}
		return false
	}
	// Normally a no-op; if the boundary didn't claim the plan, park another account's plan rather than overwrite it.
	if (useRetirementPlannerStore.getState().ownerUserId !== context.sessionUserId) {
		claimRetirementPlanFor(context.sessionUserId)
		if (useRetirementPlannerStore.getState().ownerUserId !== context.sessionUserId) {
			// Storage refused the park: keep that plan on screen.
			return false
		}
	}
	const applied = pulled
	useRetirementPlannerStore.setState({
		plan: applied,
		ownerUserId: context.sessionUserId,
		serverUpdatedAt: new Date(change.updatedAt).toISOString(),
	})
	// The server holds exactly this plan now: an edit back to it sends nothing.
	notePlanSynced(context.sessionUserId, applied)
	return true
}

const ENTITY_BINDINGS = {
	incomeSource: {
		kind: 'collection',
		store: useIncomeStore as unknown as StoreApi,
		collection: 'incomeSources',
	},
	expense: {
		kind: 'collection',
		store: useExpenseStore as unknown as StoreApi,
		collection: 'expenses',
	},
	savingsGoal: {
		kind: 'collection',
		store: useSavingsStore as unknown as StoreApi,
		collection: 'savingsGoals',
	},
	balanceTracking: {
		kind: 'collection',
		store: useBalanceStore as unknown as StoreApi,
		collection: 'entries',
	},
	userProfile: {
		kind: 'collection',
		store: useProfileStore as unknown as StoreApi,
		collection: 'profiles',
	},
	category: {
		kind: 'collection',
		store: useCategoryStore as unknown as StoreApi,
		collection: 'categories',
	},
	retirementPlan: {
		kind: 'singleton',
		read: (id) => {
			const { ownerUserId, plan } = useRetirementPlannerStore.getState()
			return ownerUserId === id ? { id, plan } : undefined
		},
		apply: applyRetirementPlanChange,
	},
} satisfies Record<SyncEntityType, EntityBinding>

export function findLocalRow(
	entityType: SyncEntityType,
	id: string
): Record<string, unknown> | undefined {
	const binding = ENTITY_BINDINGS[entityType]
	if (!binding) {
		return undefined
	}
	if (binding.kind === 'singleton') {
		return binding.read(id)
	}
	const rows = (binding.store.getState()[binding.collection] ?? []) as (Record<string, unknown> & {
		id: string
	})[]
	return rows.find((row) => row.id === id)
}

/**
 * Stamps placeholder-owned rows the server accepted, so a sign-out before the next pull can't leave them adoptable
 * by another account. Plain setState: a store action would queue a sync op per row.
 */
export function stampSyncedOwner(
	operations: readonly SyncOperation[],
	sessionUserId: string
): void {
	try {
		notePlanOpsAccepted(
			operations.filter((operation) => operation.userId === sessionUserId),
			sessionUserId
		)
	} catch (error) {
		console.error('[sync] could not record an accepted retirement plan push:', error)
	}
	const idsByType = new Map<SyncEntityType, Set<string>>()
	for (const operation of operations) {
		if (operation.type !== 'create' && operation.type !== 'update') {
			continue
		}
		// An op queued under another id (a leftover session) proves nothing about this account.
		if (operation.userId !== sessionUserId) {
			continue
		}
		const ids = idsByType.get(operation.entityType) ?? new Set<string>()
		ids.add(String(operation.entityId))
		idsByType.set(operation.entityType, ids)
	}
	for (const [entityType, ids] of idsByType) {
		if (entityType === 'retirementPlan') {
			continue
		}
		const binding = ENTITY_BINDINGS[entityType]
		// The plan's owner is written by the claim and the pull applier, never by a push.
		if (binding?.kind !== 'collection') {
			continue
		}
		const { store, collection } = binding
		try {
			const current = (store.getState()[collection] as Record<string, unknown>[] | undefined) ?? []
			let changed = false
			const next = current.map((row) => {
				const id = row['id']
				if (typeof id === 'string' && ids.has(id) && isPlaceholderOwner(row['userId'])) {
					changed = true
					return { ...row, userId: sessionUserId }
				}
				return row
			})
			if (changed) {
				store.setState({ [collection]: next })
			}
		} catch (error) {
			// One store's write failing (quota) must not stop the others.
			console.error('[stampSyncedOwner] could not mark synced rows', error)
		}
	}
}

function applyOne(change: ServerChange, context: ApplyContext): boolean {
	const binding = ENTITY_BINDINGS[change.entityType]
	if (!binding) {
		// Unknown type: a newer server's entity must not crash an older client.
		return false
	}
	if (binding.kind === 'singleton') {
		return binding.apply(change, context)
	}

	const { store, collection } = binding
	const id = change.entityId

	// An empty envelope id would be an untargetable orphan; this guards the envelope, not the row.
	if (!id) {
		reportRefusedRow(change.entityType, change.entityId, ['entityId:too_small'])
		return false
	}

	const state = store.getState()
	// Explicit `id` avoids index-signature access (TS4111 / Biome literal-keys).
	const current = (state[collection] as (Record<string, unknown> & { id: string })[]) ?? []

	const without = current.filter((item) => item.id !== id)

	if (change.isDeleted) {
		store.setState({ [collection]: without })
		// A pulled profile tombstone cascades locally: other devices never pull the child tombstones,
		// since the server filters children by the client's active profile.
		if (change.entityType === 'userProfile') {
			// Guarded: a quota/SecurityError mid-cascade must not skip the active-profile repoint below,
			// and the pull cursor has already moved past this tombstone.
			try {
				cascadeProfileRowRemoval(id)
			} catch (error) {
				console.error('[applyServerChanges] profile cascade failed', error)
			}
		}
		return true
	}

	// `change.data` is written unchanged: the schemas strip profileId, sortOrder and other undeclared keys.
	const entity = { ...change.data, id }
	store.setState({ [collection]: [...without, entity] })
	return true
}

/** Developer channel only. Values are never logged: client console output has no redaction. */
function reportRefusedRow(entityType: string, entityId: string, fields: readonly string[]): void {
	console.warn('[applyServerChanges] refused a malformed server row', {
		entityType,
		entityId,
		fields: [...fields],
	})
}

export function reportRefusedServerChanges(refused: readonly RefusedServerChange[]): void {
	for (const row of refused) {
		reportRefusedRow(row.entityType, row.entityId, row.fields)
	}
}

const ORDERED_ENTITY_TYPES: ReadonlySet<SyncEntityType> = new Set<SyncEntityType>([
	'incomeSource',
	'expense',
	'savingsGoal',
	'balanceTracking',
])

/** applyOne removes then appends, so without this a pulled update moves the row to the bottom. */
function resortCollection(entityType: SyncEntityType): void {
	const binding = ENTITY_BINDINGS[entityType]
	if (binding?.kind !== 'collection') {
		return
	}
	const { store, collection } = binding
	const current =
		(store.getState()[collection] as (Record<string, unknown> & { id: string })[]) ?? []
	// Also stamps rows without a sortOrder, or the next local row lands at the top.
	store.setState({ [collection]: stampMissingSortOrder(current) })
}

/** "Real" means this session's: another account's profiles are dropped, but their rows are not re-homed. */
function reconcileActiveProfile(sessionUserId: string): void {
	const state = useProfileStore.getState() as unknown as {
		profiles: { id: string; userId?: string; isDefault?: boolean }[]
		activeProfileId: string | null
		setProfiles: (profiles: { id: string; userId?: string; isDefault?: boolean }[]) => void
		setActiveProfileId: (id: string | null) => void
	}
	const { profiles, activeProfileId } = state
	const isPlaceholder = (p: { userId?: string }) => p.userId === undefined || p.userId === ''
	const realProfiles = profiles.filter(
		(p) => !isPlaceholder(p) && !isOwnedByAnotherAccount(p.userId, sessionUserId)
	)
	if (realProfiles.length === 0) {
		return
	}

	// By id, not identity. Only placeholder rows are re-homed, never another account's.
	const droppedPlaceholderIds = new Set(profiles.filter(isPlaceholder).map((p) => p.id))

	const active = realProfiles.find((p) => p.id === activeProfileId)
	const target = active ?? realProfiles.find((p) => p.isDefault) ?? realProfiles[0]
	if (!target) {
		return
	}

	// Re-home before dropping placeholders so a partial failure is finished by the next reconcile.
	rehomePlaceholderRows(droppedPlaceholderIds, target.id)

	// setProfiles repoints active to the first entry, so the intended id is re-asserted after.
	if (realProfiles.length !== profiles.length) {
		state.setProfiles(realProfiles)
	}
	state.setActiveProfileId(target.id)
}

/** Plain setState, not update actions: relabelling to the id the server assigns anyway must not queue sync ops. */
function rehomePlaceholderRows(placeholderIds: ReadonlySet<string>, targetId: string): void {
	if (placeholderIds.size === 0) {
		return
	}
	const bindings = Object.values(ENTITY_BINDINGS).filter(
		(binding): binding is CollectionBinding =>
			binding.kind === 'collection' && binding.collection !== 'profiles'
	)
	for (const { store, collection } of bindings) {
		const current = (store.getState()[collection] as Record<string, unknown>[] | undefined) ?? []
		let changed = false
		const next = current.map((row) => {
			const profileId = row['profileId']
			if (typeof profileId === 'string' && placeholderIds.has(profileId)) {
				changed = true
				return { ...row, profileId: targetId }
			}
			return row
		})
		if (changed) {
			store.setState({ [collection]: next })
		}
	}
}

export function applyServerChangesToStores(
	changes: ServerChange[],
	sessionUserId: string,
	options: Pick<ApplyContext, 'hasPendingOperation'> = {}
): void {
	const context = { sessionUserId, ...options } satisfies ApplyContext
	let appliedProfile = false
	const touchedOrdered = new Set<SyncEntityType>()
	for (const change of changes) {
		try {
			const applied = applyOne(change, context)
			if (!applied) {
				// Must not count as touched, or an unchanged batch triggers a re-sort.
				continue
			}
			if (change.entityType === 'userProfile') {
				appliedProfile = true
			}
			if (ORDERED_ENTITY_TYPES.has(change.entityType)) {
				touchedOrdered.add(change.entityType)
			}
		} catch {}
	}

	// Once per touched collection after the loop, not per change (O(n²)).
	for (const entityType of touchedOrdered) {
		try {
			resortCollection(entityType)
		} catch {}
	}
	// Only when profiles changed, so ordinary pulls never perturb the selected profile.
	if (appliedProfile) {
		try {
			reconcileActiveProfile(sessionUserId)
		} catch {}
	}
}
