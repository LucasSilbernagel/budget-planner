// @vitest-environment node
/**
 * A replayed profile delete LEAVES THE QUEUE — proven through the route and
 * through the whole live chain (story 76.1, FR121, AC-6).
 *
 * Real core `SynchronizationService` → real `sendSyncOperation` → real
 * `/api/sync/batch` handler → real `processBatchSync` → real PostgreSQL (PGlite,
 * full migration chain). Only the session lookup and the rate limiter are stubbed.
 * Harness copied from `permanent-rejection-chain.db.test.ts`.
 *
 * ⚠️⚠️ WHY THE WHOLE CHAIN. The defect lived in a SEAM: the server reported the
 * replay as a `delete-update` conflict, the transport checks `conflictCount`
 * BEFORE `failedCount` and answers `{ conflict: true }`, and core files it in
 * `conflictOperations` — a bucket no `removeBatch` drains. A server-only test
 * shows the envelope; only this one shows the op staying queued.
 *
 * ⚠️ Every chain test asserts that a request REACHED the route (`served`). An
 * offline service sends nothing, and "the queue empties / stays" assertions are
 * decided by that alone.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
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

const USER = '55555555-5555-4555-8555-555555555555'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(async () => ({
    success: true,
    data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
  })),
}))

import { POST as batchPOST } from '@/routes/api/sync/batch'
import { createSynchronizationService } from '@budget-planner/core/sync'
import type { SyncOperation } from '@budget-planner/core/sync'
import { userProfiles, users } from '@budget-planner/db'
import { and, eq } from 'drizzle-orm'
import { JSDOM } from 'jsdom'
import { sendSyncOperation } from '../../../features/api/client'

const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const MAIN = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const SIDE = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
const QUEUE_KEY = `bp-sync-queue-${USER}`

let pg: PGlite
let db: ReturnType<typeof drizzle>
let dom: JSDOM
let service: ReturnType<typeof createSynchronizationService> | undefined
const served: { status: number; body: string }[] = []

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://app.test')
  if (url.pathname !== '/api/sync/batch') throw new Error(`unrouted fetch ${url}`)
  const response = await batchPOST({ request: new Request(url, init) })
  const body = await response.clone().text()
  served.push({ status: response.status, body })
  return response
}

function profileDelete(id = 'op-delete-side'): SyncOperation {
  return {
    id,
    type: 'delete',
    entityType: 'userProfile',
    entityId: SIDE,
    data: { userId: USER },
    timestamp: Date.now(),
    deviceId: 'device-1',
    userId: USER,
  } as SyncOperation
}

function postBatch(operation: SyncOperation) {
  return routeFetch('/api/sync/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operations: [operation],
      clientTimestamp: Date.now(),
      deviceId: operation.deviceId,
    }),
  })
}

function persistedQueueIds(): string[] {
  const raw = localStorage.getItem(QUEUE_KEY)
  return raw ? (JSON.parse(raw) as SyncOperation[]).map((op) => op.id) : []
}

async function liveDefaults() {
  const rows = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.userId, USER),
        eq(userProfiles.isDeleted, false),
        eq(userProfiles.isDefault, true)
      )
    )
  return rows.map((row) => row.id)
}

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
    email: 'replay@example.test',
    paddleId: 'ctm_replay',
    subscriptionStatus: 'lifetime',
  })

  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
  vi.stubGlobal('localStorage', dom.window.localStorage)
  // ⚠️ Node's own `navigator` has no `onLine`, so the service would send nothing.
  vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('fetch', routeFetch)
}, 60_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  await pg?.close()
})

beforeEach(async () => {
  localStorage.clear()
  served.length = 0
  await db.delete(userProfiles).where(eq(userProfiles.userId, USER))
  await db.insert(userProfiles).values([
    { id: MAIN, userId: USER, name: 'Main', isDefault: true },
    { id: SIDE, userId: USER, name: 'Side', isDefault: false },
  ])
})

afterEach(() => {
  service?.destroy()
  service = undefined
})

describe('a replayed profile delete (story 76.1)', () => {
  it('is answered 200 / processed both times through the route, leaving one live default', async () => {
    const first = await postBatch(profileDelete('op-first'))
    // A FRESH op id (code review): the replay must be acknowledged because the
    // row is tombstoned, not because some layer dedupes a repeated op id.
    const replay = await postBatch(profileDelete('op-second'))

    expect([first.status, replay.status]).toEqual([200, 200])
    expect(JSON.parse(served[0]?.body ?? '{}')).toMatchObject({
      processedCount: 1,
      conflictCount: 0,
    })
    // RED at d54c1a8: `{ processedCount: 0, conflictCount: 1 }`.
    expect(JSON.parse(served[1]?.body ?? '{}')).toMatchObject({
      processedCount: 1,
      conflictCount: 0,
      failedCount: 0,
    })
    // An INVARIANT check, not a discriminating one: SIDE was never the default,
    // so this holds on either side of the fix. The two envelopes above are what
    // tell the fix apart.
    expect(await liveDefaults()).toEqual([MAIN])
  })

  it('whose first response was lost LEAVES the persisted queue, with no conflict recorded', async () => {
    // The first push committed, but the device never heard back: the server holds
    // the tombstone and the device still holds the op.
    await postBatch(profileDelete('op-first-push'))
    served.length = 0
    const pending = profileDelete('op-lost-response')
    localStorage.setItem(QUEUE_KEY, JSON.stringify([pending]))

    service = createSynchronizationService(USER, {
      autoSync: false,
      processOperation: sendSyncOperation,
      profileId: MAIN,
    })
    await service.initialize()
    await service.forceSync()

    // Positive anchor: the replay really reached the route.
    expect(served.map((r) => r.status)).toEqual([200])
    // RED at d54c1a8: the op stays queued and lands in `conflictOperations`.
    expect(persistedQueueIds()).toEqual([])
    expect(service.getState().conflictOperations).toEqual([])
    // Acknowledged — NOT refused: story 75.2's notice must not fire for it.
    expect(service.getState().rejectedOperations).toEqual([])
  })
})
