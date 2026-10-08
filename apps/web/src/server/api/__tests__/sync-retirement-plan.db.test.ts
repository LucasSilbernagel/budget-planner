// @vitest-environment node
/**
 * Dropped/kept assertions read the persisted queue AND what the route served: an
 * offline service sends nothing and would pass every "not queued" claim.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@budget-planner/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    get db() {
      return holder.db
    },
  }
})

vi.mock('@/server/rate-limit/db-window', () => ({
  checkDbRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const USER = '99999999-9999-4999-8999-999999999999'
const OTHER = '88888888-8888-4888-8888-888888888888'
const PROFILE = '77777777-7777-4777-8777-777777777777'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(async () => ({
    success: true,
    data: { userId: USER, subscriptionStatus: 'active', isAuthenticated: true },
  })),
}))

import { POST as batchPOST } from '@/routes/api/sync/batch'
import { GET as changesGET } from '@/routes/api/sync/changes'
import type { SyncOperation } from '@budget-planner/core/sync'
import { createSynchronizationService } from '@budget-planner/core/sync'
import { retirementPlans, userProfiles, users } from '@budget-planner/db'
import type { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { JSDOM } from 'jsdom'
import { fetchServerChanges, sendSyncOperation } from '../../../features/api/client'
import { migratedPglite } from '../../../test/pglite-migrated'

type Plan = import('../../../lib/retirement-plan').RetirementPlan
type StoreModule = typeof import('../../../stores/retirementPlannerStore')
type ApplierModule = typeof import('../../../lib/sync/applyServerChanges')
type BridgeModule = typeof import('../../../lib/sync/syncBridge')

const QUEUE_KEY = `bp-sync-queue-${USER}`

/** Every field differs from its default, so a dropped field cannot pass by luck. */
const PLAN: Plan = {
  currentAgeInput: '41',
  lifeExpectancyInput: '87',
  desiredIncomeInput: '55.000,00',
  desiredIncomeTouched: true,
  desiredIncomeLocale: 'de-DE',
  adoptedMonthlyCents: 240_000,
  incomeBasis: 'monthly',
  annualReturnInput: '5.5',
  postRetirementReturnInput: '3.0',
  postRetirementTouched: true,
  model: 'perpetual',
}

let pg: PGlite
let db: ReturnType<typeof drizzle>
let dom: JSDOM
let store: StoreModule
let applier: ApplierModule
let bridge: BridgeModule
let service: ReturnType<typeof createSynchronizationService> | undefined
const served: { path: string; status: number; body: string }[] = []

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://app.test')
  const headers = new Headers(init?.headers)
  let response: Response
  if (url.pathname === '/api/sync/batch') {
    if (typeof init?.body === 'string') {
      headers.set('content-length', String(new TextEncoder().encode(init.body).byteLength))
    }
    response = await batchPOST({ request: new Request(url, { ...init, headers }) })
  } else if (url.pathname === '/api/sync/changes') {
    response = await changesGET({ request: new Request(url, { ...init, headers }) })
  } else {
    throw new Error(`unrouted fetch ${url}`)
  }
  served.push({ path: url.pathname, status: response.status, body: await response.clone().text() })
  return response
}

const pushes = () => served.filter((r) => r.path === '/api/sync/batch')
const pushEnvelope = (i = 0) => JSON.parse(pushes()[i]?.body ?? '{}')

async function startService() {
  const sync = createSynchronizationService(USER, {
    autoSync: false,
    processOperation: sendSyncOperation,
    fetchServerChanges: (since) => fetchServerChanges(since, 100, PROFILE),
    profileId: PROFILE,
  })
  sync.onChangesPulled((changes) =>
    applier.applyServerChangesToStores(changes, USER, {
      hasPendingOperation: (entityType, entityId) =>
        sync.getQueue().hasPendingOperations(entityType, entityId),
    })
  )
  await sync.initialize()
  service = sync
  return sync
}

async function queuePlan(type: 'create' | 'update', plan: unknown) {
  const sync = service ?? (await startService())
  const payload = bridge.toServerPayload('retirementPlan', { id: USER, plan } as never, USER)
  if (type === 'create') {
    await sync.queueCreate('retirementPlan', USER, payload, USER)
  } else {
    await sync.queueUpdate('retirementPlan', USER, payload, USER)
  }
  return sync
}

async function serverRow() {
  const [row] = await db.select().from(retirementPlans).where(eq(retirementPlans.id, USER))
  return row
}

function persistedQueue(): SyncOperation[] {
  const raw = localStorage.getItem(QUEUE_KEY)
  return raw ? (JSON.parse(raw) as SyncOperation[]) : []
}

function seedQueue(ops: SyncOperation[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(ops))
}

function rawOp(overrides: Partial<SyncOperation>): SyncOperation {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    type: 'update',
    entityType: 'retirementPlan',
    entityId: USER,
    data: { plan: PLAN, userId: USER },
    timestamp: Date.now(),
    deviceId: 'device-1',
    userId: USER,
    profileId: PROFILE,
    ...overrides,
  } as SyncOperation
}

function resetStore() {
  store.useRetirementPlannerStore.setState({
    plan: { ...store.RETIREMENT_PLAN_DEFAULTS },
    ownerUserId: USER,
    serverUpdatedAt: null,
  })
}

beforeAll(async () => {
  pg = await migratedPglite()
  db = drizzle(pg)
  holder.db = db
  await db.insert(users).values({
    id: USER,
    email: 'plan@example.test',
    paddleId: 'ctm_plan',
    subscriptionStatus: 'active',
  })
  await db.insert(users).values({
    id: OTHER,
    email: 'other@example.test',
    paddleId: 'ctm_other',
    subscriptionStatus: 'active',
  })
  await db.insert(userProfiles).values({ id: PROFILE, userId: USER, name: 'Main', isDefault: true })

  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
  vi.stubGlobal('localStorage', dom.window.localStorage)
  // Node's own `navigator` has no `onLine`, so the service would send NOTHING.
  vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('fetch', routeFetch)
  // Imported AFTER the storage stub, so the persisted store binds JSDOM's storage.
  store = await import('../../../stores/retirementPlannerStore')
  applier = await import('../../../lib/sync/applyServerChanges')
  bridge = await import('../../../lib/sync/syncBridge')
}, 60_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  await pg?.close()
})

beforeEach(async () => {
  localStorage.clear()
  served.length = 0
  await db.delete(retirementPlans)
  resetStore()
})

afterEach(() => {
  service?.destroy()
  service = undefined
})

describe('AC-2: the plan round-trips through the real chain, both directions', () => {
  it('(a)+(e) an UPDATE with no server row creates it (upsert), and pulls back identically', async () => {
    const sync = await queuePlan('update', PLAN)
    await sync.forceSync()

    expect(pushes().map((r) => r.status)).toEqual([200])
    expect(pushEnvelope()).toMatchObject({ processedCount: 1, conflictCount: 0, failedCount: 0 })
    expect(persistedQueue()).toEqual([])
    const row = await serverRow()
    expect(row?.plan).toEqual(PLAN)
    expect(row?.userId).toBe(USER)

    resetStore()
    const result = await sync.pull()
    expect(result.applied.map((c) => c.entityType)).toContain('retirementPlan')
    const state = store.useRetirementPlannerStore.getState()
    expect(state.plan).toEqual(PLAN)
    expect(state.ownerUserId).toBe(USER)
    expect(state.serverUpdatedAt).toBe(row?.updatedAt.toISOString())
  })

  it('(b) a field CLEARED to the empty string lands as the empty string', async () => {
    const sync = await queuePlan('update', PLAN)
    await sync.forceSync()
    await queuePlan('update', { ...PLAN, currentAgeInput: '', desiredIncomeInput: '' })
    await sync.forceSync()

    expect(pushes().map((r) => r.status)).toEqual([200, 200])
    expect((await serverRow())?.plan).toMatchObject({ currentAgeInput: '', desiredIncomeInput: '' })
    resetStore()
    await sync.pull()
    expect(store.useRetirementPlannerStore.getState().plan).toMatchObject({
      currentAgeInput: '',
      desiredIncomeInput: '',
    })
  })

  it('(c) adoptedMonthlyCents set, then null, lands as null', async () => {
    const sync = await queuePlan('update', PLAN)
    await sync.forceSync()
    expect((await serverRow())?.plan).toMatchObject({ adoptedMonthlyCents: 240_000 })

    await queuePlan('update', { ...PLAN, adoptedMonthlyCents: null })
    await sync.forceSync()

    const plan = (await serverRow())?.plan as Record<string, unknown>
    // A present `null`, not a missing key.
    expect(Object.hasOwn(plan, 'adoptedMonthlyCents')).toBe(true)
    expect(plan['adoptedMonthlyCents']).toBeNull()
    store.useRetirementPlannerStore.setState({
      plan: { ...store.RETIREMENT_PLAN_DEFAULTS, adoptedMonthlyCents: 5 },
    })
    await sync.pull()
    expect(store.useRetirementPlannerStore.getState().plan.adoptedMonthlyCents).toBeNull()
  })

  it('(d) both *Touched flags flip false→true and survive', async () => {
    const untouched = { ...PLAN, desiredIncomeTouched: false, postRetirementTouched: false }
    const sync = await queuePlan('update', untouched)
    await sync.forceSync()
    // The coercion collapses an untouched post-retirement rate to ''.
    expect((await serverRow())?.plan).toMatchObject({
      desiredIncomeTouched: false,
      postRetirementTouched: false,
      postRetirementReturnInput: '',
    })

    await queuePlan('update', PLAN)
    await sync.forceSync()
    expect((await serverRow())?.plan).toMatchObject({
      desiredIncomeTouched: true,
      postRetirementTouched: true,
    })
    resetStore()
    await sync.pull()
    expect(store.useRetirementPlannerStore.getState().plan).toMatchObject({
      desiredIncomeTouched: true,
      postRetirementTouched: true,
      postRetirementReturnInput: '3.0',
    })
  })

  it('(f) a CREATE over an existing row is acknowledged, and the row is unchanged', async () => {
    const sync = await queuePlan('update', PLAN)
    await sync.forceSync()
    const before = await serverRow()

    await queuePlan('create', { ...PLAN, currentAgeInput: '60' })
    await sync.forceSync()

    expect(pushes().map((r) => r.status)).toEqual([200, 200])
    expect(pushEnvelope(1)).toMatchObject({ processedCount: 1, conflictCount: 0, failedCount: 0 })
    expect(persistedQueue()).toEqual([])
    const after = await serverRow()
    expect(after?.plan).toEqual(PLAN)
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
  })

  it('(f) RACE: a create whose conflict check missed the row is still insert-if-absent', async () => {
    // PGlite is one connection, so the race window is simulated by stubbing the
    // conflict check's existence SELECT to see no row.
    const sync = await queuePlan('update', PLAN)
    await sync.forceSync()
    const before = await serverRow()
    await queuePlan('create', { ...PLAN, currentAgeInput: '60' })
    let fired = 0
    const select = vi.spyOn(db, 'select').mockImplementationOnce((() => {
      fired++
      return { from: () => ({ where: () => ({ limit: async () => [] }) }) }
    }) as never)
    try {
      await sync.forceSync()
    } finally {
      select.mockRestore()
    }

    expect(fired).toBe(1)
    expect(pushEnvelope(1)).toMatchObject({ processedCount: 1, failedCount: 0, conflictCount: 0 })
    expect(persistedQueue()).toEqual([])
    const after = await serverRow()
    expect(after?.plan).toEqual(PLAN)
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime())
  })

  it('a CREATE with no row inserts it (insert-if-absent)', async () => {
    const sync = await queuePlan('create', PLAN)
    await sync.forceSync()
    expect(pushEnvelope()).toMatchObject({ processedCount: 1, failedCount: 0 })
    expect((await serverRow())?.plan).toEqual(PLAN)
  })

  it('stores the PARSED plan: an undeclared key never reaches the jsonb column', async () => {
    // Written straight into the queue: the client gate would have stripped it.
    seedQueue([rawOp({ data: { plan: { ...PLAN, injected: 'x' }, userId: USER } })])
    const sync = await startService()
    await sync.forceSync()
    expect(pushEnvelope()).toMatchObject({ processedCount: 1 })
    expect((await serverRow())?.plan).toEqual(PLAN)
  })

  it('pulls the plan whatever the active profile is (user-scoped, outside the profile branch)', async () => {
    const sync = await queuePlan('update', PLAN)
    await sync.forceSync()
    resetStore()
    // No profile header at all: profile-scoped tables are not pulled, the plan is.
    const changes = await fetchServerChanges(null, 100, undefined)
    expect(changes.map((c) => c.entityType)).toEqual(['userProfile', 'retirementPlan'])
  })
})

describe('AC-6: no rejection path can deadlock — each op has a FATE', () => {
  it('(a) client gate: an over-long field is a ZodError before queue.add — nothing queued, nothing sent', async () => {
    const sync = await startService()
    // Straight to core: toServerPayload clamps strings, so only a direct op can
    // reach the gate with this payload.
    await expect(
      sync.queueUpdate(
        'retirementPlan',
        USER,
        { plan: { ...PLAN, currentAgeInput: 'x'.repeat(300) }, userId: USER },
        USER
      )
    ).rejects.toThrow()
    await sync.forceSync()
    expect(sync.getQueue().getAll()).toEqual([])
    expect(persistedQueue()).toEqual([])
    expect(pushes()).toEqual([])
  })

  it('(a2) through the bridge, an over-long field is CLAMPED and lands (99.2 review)', async () => {
    const sync = await queuePlan('update', { ...PLAN, currentAgeInput: 'x'.repeat(300) })
    await sync.forceSync()
    expect(sync.getQueue().getAll()).toEqual([])
    const row = await serverRow()
    expect((row?.plan as Record<string, unknown>)['currentAgeInput']).toBe('x'.repeat(255))
  })

  it.each([
    ['a NUL (jsonb 22P05)', 'abc\u0000'],
    ['a lone surrogate (jsonb 22P02)', '\ud800'],
  ])(
    '(b2) a string jsonb cannot hold, %s, is DROPPED, never kept queued (99.2 review)',
    async (_label, bad) => {
      // Text columns accept these; the jsonb column refuses them with a non-permanent
      // SQLSTATE, which would replay until the circuit breaker stops sync.
      const op = rawOp({ data: { plan: { ...PLAN, desiredIncomeInput: bad }, userId: USER } })
      seedQueue([op])
      const sync = await startService()
      await sync.forceSync()

      expect(persistedQueue().map((queued) => queued.id)).not.toContain(op.id)
      expect(sync.getState().rejectedOperations.map((rejected) => rejected.id)).toContain(op.id)
      expect(await serverRow()).toBeUndefined()
    }
  )

  it('(b) server zod refusal → 400 invalid-request → DROPPED', async () => {
    const { model: _model, ...partial } = PLAN
    const bad = rawOp({ data: { plan: partial, userId: USER } })
    seedQueue([bad])
    const sync = await startService()
    await sync.forceSync()

    expect(pushes().map((r) => r.status)).toEqual([400])
    expect(pushEnvelope()).toMatchObject({ refusal: 'invalid-request' })
    expect(persistedQueue().map((op) => op.id)).not.toContain(bad.id)
    expect(sync.getState().rejectedOperations.map((op) => op.id)).toContain(bad.id)
    expect(await serverRow()).toBeUndefined()
  })

  it('(c) entityId ≠ userId → rejection invalid → (client 422) → DROPPED, nothing written', async () => {
    const bad = rawOp({ entityId: OTHER })
    seedQueue([bad])
    const sync = await startService()
    await sync.forceSync()

    // The route answers 200 with a per-op `rejection`; the client transport maps
    // it to 422, which core drops.
    expect(pushes().map((r) => r.status)).toEqual([200])
    expect(pushEnvelope()).toMatchObject({
      failedCount: 1,
      rejections: [{ operationId: bad.id, reason: 'invalid' }],
    })
    expect(persistedQueue().map((op) => op.id)).not.toContain(bad.id)
    expect(sync.getState().rejectedOperations.map((op) => op.id)).toContain(bad.id)
    expect(await db.select().from(retirementPlans)).toEqual([])
  })

  it('(d) a DELETE → rejection invalid → (client 422) → DROPPED (never a kept delete-update conflict)', async () => {
    const bad = rawOp({ type: 'delete', data: { userId: USER } })
    seedQueue([bad])
    const sync = await startService()
    await sync.forceSync()

    expect(pushes().map((r) => r.status)).toEqual([200])
    expect(pushEnvelope()).toMatchObject({
      conflictCount: 0,
      rejections: [{ operationId: bad.id, reason: 'invalid' }],
    })
    expect(persistedQueue().map((op) => op.id)).not.toContain(bad.id)
  })

  it('(d) a DELETE of an EXISTING plan is refused too, and the row stays', async () => {
    await db.insert(retirementPlans).values({ id: USER, userId: USER, plan: PLAN })
    const bad = rawOp({ type: 'delete', data: { userId: USER } })
    seedQueue([bad])
    const sync = await startService()
    await sync.forceSync()

    expect(pushes().map((r) => r.status)).toEqual([200])
    expect(persistedQueue()).toEqual([])
    expect((await serverRow())?.plan).toEqual(PLAN)
  })

  it('(g) a malformed PULLED row (non-object plan) is refused: local plan kept, no store write', async () => {
    await pg.exec(
      `INSERT INTO "retirementPlans" ("id", "userId", "plan") VALUES ('${USER}', '${USER}', '[1,2]'::jsonb)`
    )
    store.useRetirementPlannerStore.setState({ plan: PLAN, serverUpdatedAt: null })
    const writes: unknown[] = []
    const unsubscribe = store.useRetirementPlannerStore.subscribe((state) => writes.push(state))
    const sync = await startService()
    try {
      const result = await sync.pull()
      expect(result.refused).toEqual([
        { entityType: 'retirementPlan', entityId: USER, fields: ['plan:invalid_type'] },
      ])
    } finally {
      unsubscribe()
    }
    expect(writes).toEqual([])
    expect(store.useRetirementPlannerStore.getState().plan).toEqual(PLAN)
    expect(store.useRetirementPlannerStore.getState().serverUpdatedAt).toBeNull()
  })
})

describe('AC-4: a still-queued plan edit is not overwritten by the pull', () => {
  it('core LWW keeps the newer queued edit, and the store is not touched', async () => {
    // The server holds an OLDER plan; this device queued a newer edit (its
    // timestamp is later than the row) and has not pushed it yet.
    await db.insert(retirementPlans).values({
      id: USER,
      userId: USER,
      plan: { ...PLAN, currentAgeInput: '30' },
      updatedAt: new Date(Date.now() - 60_000),
    })
    store.useRetirementPlannerStore.setState({ plan: { ...PLAN, currentAgeInput: '50' } })
    const sync = await queuePlan('update', { ...PLAN, currentAgeInput: '50' })

    await sync.pull()

    expect(store.useRetirementPlannerStore.getState().plan.currentAgeInput).toBe('50')
    expect(sync.getQueue().getAll()).toHaveLength(1)
    await sync.forceSync()
    expect((await serverRow())?.plan).toMatchObject({ currentAgeInput: '50' })
  })
})
