// @vitest-environment node
/**
 * A profile deleted on another device does not strand this device's queue, and
 * a deletion that LOST does not move the default (story 76.2, FR121).
 *
 * Real `ActiveSync` → `useSync` → core `SynchronizationService` → real
 * `sendSyncOperation` / `fetchServerChangesWithMeta` → real `/api/sync/batch` and
 * `/api/sync/changes` handlers → real PostgreSQL (PGlite, full migration chain).
 * Only the session lookup, the rate limiter and the logger are stubbed. Harness
 * from `refused-edit-notice.db.test.tsx`.
 *
 * "Device A" is the server state: its effects are written through the route (a
 * delete) or straight into the table (an edit), before or while device B runs.
 *
 * ⚠️⚠️ ORDERING IS CONTROLLED. `/api/sync/batch` is held by a gate this file
 * opens by hand, so every assertion about B's queue is made after B's pull and
 * BEFORE any push can answer for it. Without the gate the mount-time push could
 * decide the outcome by itself.
 *
 * ⚠️ Every test asserts a positive anchor: a pull REACHED the route, and B
 * applied the profile change it carried.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@budget-planner/db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../../../packages/db/src/schema'
  )
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

const USER = '76767676-7676-4767-8767-767676767676'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(async () => ({
    success: true,
    data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
  })),
}))

import { POST as batchPOST } from '@/routes/api/sync/batch'
import { GET as changesGET } from '@/routes/api/sync/changes'
import type { SyncOperation } from '@budget-planner/core/sync'
import { incomeSources, userProfiles, users } from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import type { drizzle as Drizzle } from 'drizzle-orm/pglite'
import { JSDOM } from 'jsdom'

type RTL = typeof import('@testing-library/react')
let rtl: RTL
let resetSyncStore: typeof import('@/hooks/useSync').resetSyncStore
let useProfileStore: typeof import('@/stores/profileStore').useProfileStore
let isSyncActive: typeof import('@/lib/sync/syncBridge').isSyncActive
let ActiveSync: typeof import('../ActiveSync').ActiveSync

const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const QUEUE_KEY = `bp-sync-queue-${USER}`
const MAIN = '7a000000-0000-4000-8000-000000000001'
const P = '7a000000-0000-4000-8000-000000000002'
const Y = '7a000000-0000-4000-8000-000000000003'
const R1 = '7b000000-0000-4000-8000-000000000001'
const C1 = '7b000000-0000-4000-8000-000000000002'
const Z = '7a000000-0000-4000-8000-000000000004'
const OLD_ISO = '2026-09-01T00:00:00.000Z'
const OLD = new Date(OLD_ISO)

let pg: PGlite
let db: ReturnType<typeof Drizzle>
/** Every request the routes served, in order: `"<METHOD> <path> <status>"`. */
const served: string[] = []
/** The JSON bodies `/api/sync/batch` answered with. */
const batchAnswers: string[] = []
let openBatch: () => void = () => {}
let batchGate: Promise<void> = Promise.resolve()
/**
 * Bumped per test. A request records its answer only if it STARTED in the
 * current test: an unmounted engine's push, released late, must not leak into
 * the next test's assertions (it did, on `main`, before this guard).
 */
let generation = 0

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://app.test')
  const request = new Request(url, init)
  const startedIn = generation
  if (url.pathname === '/api/sync/batch') {
    await batchGate
    const response = await batchPOST({ request })
    if (startedIn === generation) {
      batchAnswers.push(await response.clone().text())
      served.push(`POST ${url.pathname} ${response.status}`)
    }
    return response
  }
  if (url.pathname === '/api/sync/changes') {
    const response = await changesGET({ request })
    if (startedIn === generation) {
      served.push(`GET ${url.pathname} ${response.status}`)
    }
    return response
  }
  throw new Error(`unrouted fetch ${url}`)
}

/** Device A's push, straight through the route (it does not wait on B's gate). */
async function deviceAPushes(operation: Partial<SyncOperation>): Promise<void> {
  const response = await batchPOST({
    request: new Request('https://app.test/api/sync/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            deviceId: 'device-a',
            userId: USER,
            ...operation,
          },
        ],
        clientTimestamp: Date.now(),
        deviceId: 'device-a',
      }),
    }),
  })
  expect(JSON.parse(await response.text())).toMatchObject({ processedCount: 1 })
}

function queuedOp(overrides: Partial<SyncOperation>): SyncOperation {
  return {
    id: crypto.randomUUID(),
    type: 'update',
    entityType: 'incomeSource',
    entityId: R1,
    data: { userId: USER, name: 'Salary', amount: 1000, frequency: 'monthly' },
    timestamp: Date.now(),
    deviceId: 'device-b',
    userId: USER,
    ...overrides,
  } as SyncOperation
}

function persistedQueue(): SyncOperation[] {
  const raw = localStorage.getItem(QUEUE_KEY)
  return raw ? (JSON.parse(raw) as SyncOperation[]) : []
}

/** `"<type>:<entityType>:<name-or-id>"` per queued op: readable in a RED diff. */
function queueSummary(): string[] {
  return persistedQueue().map((o) => `${o.type}:${o.entityType}:${o.entityId}`)
}

function localProfile(id: string, name: string, isDefault: boolean) {
  return {
    id,
    userId: USER,
    name,
    isDefault,
    currency: 'NONE',
    createdAt: OLD_ISO,
    updatedAt: OLD_ISO,
  }
}

function localDefaults(): string[] {
  return useProfileStore
    .getState()
    .profiles.filter((p) => p.isDefault)
    .map((p) => p.name)
}

async function serverDefaults(): Promise<string[]> {
  const rows = await db
    .select({ name: userProfiles.name })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.userId, USER),
        eq(userProfiles.isDefault, true),
        eq(userProfiles.isDeleted, false)
      )
    )
  return rows.map((r) => r.name)
}

const pulls = () => served.filter((s) => s.startsWith('GET /api/sync/changes')).length

beforeAll(async () => {
  pg = new PGlite()
  const journal = JSON.parse(readFileSync(resolve(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const sql = readFileSync(resolve(MIGRATIONS, `${entry.tag}.sql`), 'utf8')
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) {
        await pg.exec(statement)
      }
    }
  }
  db = drizzle(pg)
  holder.db = db
  await db.insert(users).values({
    id: USER,
    email: 'remote-delete@example.test',
    paddleId: 'ctm_remote_delete',
    subscriptionStatus: 'lifetime',
  })
  vi.stubGlobal('fetch', routeFetch)

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
  // ⚠️ `localStorage` and `navigator` MUST come from the JSDOM window — see
  // `cross-device-sync.db.test.tsx` and `permanent-rejection-chain.db.test.ts`.
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'Node',
    'navigator',
    'MutationObserver',
    'localStorage',
  ]) {
    vi.stubGlobal(
      key,
      key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]
    )
  }
  const { createJSONStorage } = await import('zustand/middleware')
  const persisted = await Promise.all([
    import('@/stores/incomeStore').then((m) => m.useIncomeStore),
    import('@/stores/expenseStore').then((m) => m.useExpenseStore),
    import('@/stores/savingsStore').then((m) => m.useSavingsStore),
    import('@/stores/balanceStore').then((m) => m.useBalanceStore),
    import('@/stores/categoryStore').then((m) => m.useCategoryStore),
    import('@/stores/currencyStore').then((m) => m.useCurrencyStore),
    import('@/stores/profileStore').then((m) => m.useProfileStore),
  ])
  for (const store of persisted) {
    const api = (store as { persist?: { setOptions: (o: Record<string, unknown>) => void } })
      .persist
    api?.setOptions({ storage: createJSONStorage(() => dom.window.localStorage) })
  }

  rtl = await import('@testing-library/react')
  ;({ resetSyncStore } = await import('@/hooks/useSync'))
  ;({ useProfileStore } = await import('@/stores/profileStore'))
  ;({ isSyncActive } = await import('@/lib/sync/syncBridge'))
  ;({ ActiveSync } = await import('../ActiveSync'))
}, 60_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  await pg?.close()
})

beforeEach(async () => {
  generation++
  served.length = 0
  batchAnswers.length = 0
  batchGate = new Promise<void>((r) => {
    openBatch = r
  })
  localStorage.clear()
  await db.delete(incomeSources).where(eq(incomeSources.userId, USER))
  await db.delete(userProfiles).where(eq(userProfiles.userId, USER))
})

afterEach(() => {
  // The gate is NOT opened here: a push this test left held stays held, so it
  // cannot write to the next test's database state.
  rtl.cleanup()
  resetSyncStore()
})

describe('a profile deleted on another device (story 76.2)', () => {
  it('AC-1: its queued child ops leave this device’s queue in the pull that brings the tombstone', async () => {
    await db.insert(userProfiles).values([
      { id: MAIN, userId: USER, name: 'Main', isDefault: true, updatedAt: OLD },
      { id: P, userId: USER, name: 'Side', isDefault: false, updatedAt: OLD },
    ])
    await db.insert(incomeSources).values({
      id: R1,
      userId: USER,
      profileId: P,
      name: 'Salary',
      amount: 1000,
      frequency: 'monthly',
      updatedAt: OLD,
    } as never)
    useProfileStore.setState({
      profiles: [localProfile(MAIN, 'Main', true), localProfile(P, 'Side', false)],
      activeProfileId: MAIN,
    })
    // B's offline edits in P: a new row, and an edit of a row the server has.
    const childCreate = queuedOp({
      type: 'create',
      entityId: C1,
      data: { userId: USER, name: 'Bonus', amount: 500, frequency: 'monthly' },
      profileId: P,
    })
    const childUpdate = queuedOp({ profileId: P, baseVersion: OLD.getTime() })
    localStorage.setItem(QUEUE_KEY, JSON.stringify([childCreate, childUpdate]))
    // Device A deletes P: the server tombstones P and cascades R1.
    await deviceAPushes({
      type: 'delete',
      entityType: 'userProfile',
      entityId: P,
      data: { userId: USER },
    })

    rtl.render(<ActiveSync userId={USER} />)

    // Positive anchor: B pulled, and applied P's tombstone (66.3 cascade).
    await rtl.waitFor(
      () => expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([MAIN]),
      { timeout: 15_000 }
    )
    expect(pulls()).toBeGreaterThan(0)
    // RED at 145cb27: both child ops are still queued.
    expect(queueSummary()).toEqual([])

    // Now let the push through that mount started (it is held at the gate).
    // RED at 145cb27, measured: `Profile not found` (failed, no rejection) and
    // an `update-delete` conflict, on every push.
    //
    // ⚠️ That push was ALREADY IN FLIGHT when the pull dropped the ops: core's
    // push loop sends from the batch it took, so it still sends them ONCE
    // (deferred-work, story 76.2: "A push already in flight…"). What this story
    // guarantees is that they are not queued afterwards, so no LATER push
    // carries them.
    openBatch()
    // Positive anchor: that push really reached the route and was answered.
    await rtl.waitFor(() => expect(batchAnswers.length).toBeGreaterThan(0), { timeout: 15_000 })
    await rtl.act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    // After a real push round trip, still nothing is queued: no later push
    // can carry them.
    expect(queueSummary()).toEqual([])
    // Not a refusal: no notice for rows the user can no longer see.
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0)
  }, 60_000)

  it('AC-4: a deletion that LOST last-writer-wins does not move the default, and leaves one local default', async () => {
    await db.insert(userProfiles).values([
      { id: MAIN, userId: USER, name: 'Main', isDefault: true, updatedAt: OLD },
      { id: Y, userId: USER, name: 'Travel', isDefault: false, updatedAt: OLD },
    ])
    useProfileStore.setState({
      profiles: [localProfile(MAIN, 'Main', true), localProfile(Y, 'Travel', false)],
      activeProfileId: MAIN,
    })

    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(() => expect(isSyncActive()).toBe(true), { timeout: 15_000 })
    await rtl.waitFor(() => expect(pulls()).toBeGreaterThan(0), { timeout: 15_000 })
    // Let the mount pull settle before A's edit, so it cannot carry it.
    await new Promise((r) => setTimeout(r, 300))

    // Device A renames Main AFTER B last saw it.
    await db
      .update(userProfiles)
      .set({ name: 'Main (renamed on A)', updatedAt: new Date() })
      .where(eq(userProfiles.id, MAIN))

    // B deletes its active default: tombstone + promotion of Travel, queued
    // (the push is held). The active-profile switch triggers a full re-pull,
    // which carries A's newer Main: B's deletion loses LWW.
    const pullsBefore = pulls()
    await rtl.act(async () => {
      useProfileStore.getState().removeProfile(MAIN)
    })
    await rtl.waitFor(
      () =>
        expect(
          useProfileStore
            .getState()
            .profiles.map((p) => p.name)
            .sort()
        ).toEqual(['Main (renamed on A)', 'Travel']),
      { timeout: 15_000 }
    )
    expect(pulls()).toBeGreaterThan(pullsBefore)

    // RED at 145cb27: the promotion stays queued and BOTH profiles are default here.
    await rtl.waitFor(() => expect(queueSummary()).toEqual([]), { timeout: 15_000 })
    await rtl.waitFor(() => expect(localDefaults()).toEqual(['Main (renamed on A)']), {
      timeout: 15_000,
    })

    // And nothing moves the default on the server when pushes resume. The
    // debounced push (2s after the edit) finds an empty queue, so NO request is
    // made; on 145cb27 the promotion was queued, pushed, and moved the default
    // to Travel. Both checks together tell the two apart.
    openBatch()
    await new Promise((r) => setTimeout(r, 2500))
    expect(batchAnswers).toEqual([])
    expect(await serverDefaults()).toEqual(['Main (renamed on A)'])
  }, 60_000)

  it('the route accepts an op carrying dependsOn and ignores the field (Task 3.1)', async () => {
    await db.insert(userProfiles).values([
      { id: MAIN, userId: USER, name: 'Main', isDefault: true, updatedAt: OLD },
      { id: Y, userId: USER, name: 'Travel', isDefault: false, updatedAt: OLD },
    ])

    // `deviceAPushes` asserts `processedCount: 1`: a strict request schema would
    // have refused the whole batch (400).
    await deviceAPushes({
      type: 'update',
      entityType: 'userProfile',
      entityId: Y,
      data: { userId: USER, name: 'Travel', isDefault: true, currency: 'NONE' },
      dependsOn: { entityType: 'userProfile', entityId: MAIN, type: 'delete' },
    })

    expect(await serverDefaults()).toEqual(['Travel'])
  })

  it('AC-2 trap control: deleting the ACTIVE default keeps the promotion when the tombstone comes back', async () => {
    // ⚠️ THREE profiles, and Archive is the OLDEST. When P's tombstone lands the
    // server's repair seats the oldest survivor and bumps its `updatedAt`. With
    // Travel as the only survivor the repair would bump TRAVEL, and B's promotion
    // would lose last-writer-wins for a reason unrelated to this story.
    await db.insert(userProfiles).values([
      {
        id: Z,
        userId: USER,
        name: 'Archive',
        isDefault: false,
        createdAt: new Date('2026-01-01'),
        updatedAt: OLD,
      },
      {
        id: P,
        userId: USER,
        name: 'Home',
        isDefault: true,
        createdAt: new Date('2026-02-01'),
        updatedAt: OLD,
      },
      {
        id: Y,
        userId: USER,
        name: 'Travel',
        isDefault: false,
        createdAt: new Date('2026-03-01'),
        updatedAt: OLD,
      },
    ])
    useProfileStore.setState({
      profiles: [
        localProfile(P, 'Home', true),
        localProfile(Y, 'Travel', false),
        localProfile(Z, 'Archive', false),
      ],
      activeProfileId: P,
    })

    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(() => expect(isSyncActive()).toBe(true), { timeout: 15_000 })
    await rtl.waitFor(() => expect(pulls()).toBeGreaterThan(0), { timeout: 15_000 })
    await new Promise((r) => setTimeout(r, 300))

    await rtl.act(async () => {
      useProfileStore.getState().removeProfile(P)
    })
    await rtl.waitFor(() => expect(persistedQueue()).toHaveLength(2), { timeout: 15_000 })
    const promotion = persistedQueue().find((o) => o.entityId === Y) as SyncOperation
    // MEASURED (Task 1.3): the promotion carries the DELETED profile's stamp —
    // the queue ran before the active-profile switch reached the sync config.
    expect(promotion.profileId).toBe(P)

    // P's tombstone reaches the server before B's own delete does (another
    // device, or this one with its response lost), and B's next pull brings it.
    await deviceAPushes({
      type: 'delete',
      entityType: 'userProfile',
      entityId: P,
      data: { userId: USER },
    })
    // A reload: engine gone, queue kept. Its mount pull is a full snapshot.
    rtl.cleanup()
    resetSyncStore()
    const pullsBefore = pulls()
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(() => expect(pulls()).toBeGreaterThan(pullsBefore), { timeout: 15_000 })
    await new Promise((r) => setTimeout(r, 300))

    // The deletion HAPPENED, so the promotion is still the user's choice.
    expect(queueSummary()).toEqual([`update:userProfile:${Y}`])

    // Discriminating: without the promotion the repair's pick (Archive) stays.
    openBatch()
    await rtl.waitFor(async () => expect(await serverDefaults()).toEqual(['Travel']), {
      timeout: 15_000,
    })
    expect(batchAnswers.join(' ')).not.toMatch(/update-delete/)
  }, 60_000)
})
