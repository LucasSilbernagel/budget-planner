// @vitest-environment node
/**
 * A permanently refused edit is NAMED to the user and REVERTED on this device
 * (story 75.2, FR119) — proven through the whole live chain.
 *
 * Real `ActiveSync` → `useSync` → core `SynchronizationService` → real
 * `sendSyncOperation` → real `/api/sync/batch` + `/api/sync/changes` handlers →
 * real PostgreSQL (PGlite, full migration chain). Only the session lookup, the
 * rate limiter and the logger are stubbed.
 *
 * DECISION (Lucas, 2026-09-28): REVERT. A refused create is removed locally, a
 * refused update or delete is restored from the server by a full re-pull.
 *
 * ⚠️ The bad op is written into the persisted queue DIRECTLY, as in 75.1's chain
 * test: the client queue gate refuses these values, so no form in today's app
 * can produce a permanent refusal. They arrive from queues written before a gate
 * existed or from version skew — this file is about what happens once one does.
 *
 * ⚠️⚠️ ORDERING IS CONTROLLED, and the revert tests depend on it. `ActiveSync`
 * starts a full pull and a push at mount. If the push landed first, that
 * initial full pull would restore the server value BY ITSELF and a missing
 * revert would pass unnoticed. So `/api/sync/batch` is held until the first
 * `/api/sync/changes` response has been served: the initial pull then sees the
 * bad op still queued and newer than the server row, and SUPPRESSES that row
 * (core's pull LWW). After the refusal, only the story's explicit re-pull can
 * bring the server value back before the 30s poll.
 *
 * ⚠️ Every test asserts a positive anchor — a request REACHED the route — so an
 * offline service (Node's `navigator` has no `onLine`) cannot pass vacuously.
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

const USER = '55555555-5555-4555-8555-555555555555'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(async () => ({
    success: true,
    data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
  })),
}))

import { POST as batchPOST } from '@/routes/api/sync/batch'
import { GET as changesGET } from '@/routes/api/sync/changes'
import type { SyncOperation } from '@budget-planner/core/sync'
import { savingsGoals, userProfiles, users } from '@budget-planner/db'
import { eq } from 'drizzle-orm'
import type { drizzle as Drizzle } from 'drizzle-orm/pglite'
import { JSDOM } from 'jsdom'

type RTL = typeof import('@testing-library/react')
let rtl: RTL
let resetSyncStore: typeof import('@/hooks/useSync').resetSyncStore
let useSavingsStore: typeof import('@/stores/savingsStore').useSavingsStore
let useProfileStore: typeof import('@/stores/profileStore').useProfileStore
let ActiveSync: typeof import('../ActiveSync').ActiveSync

const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const PROFILE = 'ffffffff-ffff-4fff-8fff-ffffffffff01'
const GOAL = '50000000-0000-4000-8000-0000000000c1'
const QUEUE_KEY = `bp-sync-queue-${USER}`

let pg: PGlite
let db: ReturnType<typeof Drizzle>
/** Every request the routes served, in order: `"<METHOD> <path> <status>"`. */
const served: string[] = []
/** Bodies of every POST to /api/sync/batch, parsed. */
const pushed: { operations: SyncOperation[] }[] = []
let releaseBatch: () => void = () => {}
let batchGate: Promise<void> = Promise.resolve()

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://app.test')
  const request = new Request(url, init)
  if (url.pathname === '/api/sync/batch') {
    await batchGate
    pushed.push(JSON.parse(await request.clone().text()))
    const response = await batchPOST({ request })
    served.push(`POST ${url.pathname} ${response.status}`)
    return response
  }
  if (url.pathname === '/api/sync/changes') {
    const response = await changesGET({ request })
    served.push(`GET ${url.pathname} ${response.status}`)
    // The first pull has been answered: pushes may now proceed (see header).
    releaseBatch()
    return response
  }
  throw new Error(`unrouted fetch ${url}`)
}

function queuedOp(overrides: Partial<SyncOperation>): SyncOperation {
  return {
    id: `op-${Math.random().toString(36).slice(2)}`,
    type: 'update',
    entityType: 'savingsGoal',
    entityId: GOAL,
    data: { userId: USER, name: 'Emergency fund', currentBalance: -1 },
    timestamp: Date.now(),
    deviceId: 'device-1',
    userId: USER,
    profileId: PROFILE,
    ...overrides,
  } as SyncOperation
}

function persistedQueue(): SyncOperation[] {
  const raw = localStorage.getItem(QUEUE_KEY)
  return raw ? (JSON.parse(raw) as SyncOperation[]) : []
}

function localGoal(id: string, name: string, currentBalance: number) {
  return {
    id,
    userId: 0,
    profileId: PROFILE,
    name,
    targetAmount: null,
    currentBalance,
    allocationMode: 'automatic',
    monthlyAllocation: null,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }
}

function alerts(): string[] {
  return Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent ?? '')
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
    email: 'notice@example.test',
    paddleId: 'ctm_notice',
    subscriptionStatus: 'lifetime',
  })
  await db.insert(userProfiles).values({ id: PROFILE, userId: USER, name: 'Main', isDefault: true })
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
    'KeyboardEvent',
  ]) {
    vi.stubGlobal(
      key,
      key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]
    )
  }
  // Rebind persisted stores to the JSDOM storage (same reason as
  // `cross-device-sync.db.test.tsx`).
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
  ;({ useSavingsStore } = await import('@/stores/savingsStore'))
  ;({ useProfileStore } = await import('@/stores/profileStore'))
  ;({ ActiveSync } = await import('../ActiveSync'))
}, 60_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  await pg?.close()
})

beforeEach(async () => {
  served.length = 0
  pushed.length = 0
  batchGate = new Promise<void>((r) => {
    releaseBatch = r
  })
  localStorage.clear()
  await db.delete(savingsGoals).where(eq(savingsGoals.userId, USER))
  await db.insert(savingsGoals).values({
    id: GOAL,
    userId: USER,
    profileId: PROFILE,
    name: 'Emergency fund',
    currentBalance: 1000,
  } as never)
  useProfileStore.setState({
    profiles: [{ id: PROFILE, userId: USER, name: 'Main', isDefault: true, currency: 'NONE' }],
    activeProfileId: PROFILE,
  })
})

afterEach(() => {
  // Dismiss whatever this test left on screen, so the next test starts clean,
  // then unmount (a page reload: engine gone, localStorage kept).
  for (const button of Array.from(document.querySelectorAll('button'))) {
    if (/^Dismiss/.test(button.getAttribute('aria-label') ?? '')) {
      rtl.fireEvent.click(button)
    }
  }
  rtl.cleanup()
  resetSyncStore()
})

describe('a refused edit is named and reverted (story 75.2)', () => {
  it('names a refused UPDATE and changes the local value back to the server value', async () => {
    useSavingsStore.setState({ savingsGoals: [localGoal(GOAL, 'Emergency fund', -1)] as never })
    const bad = queuedOp({})
    localStorage.setItem(QUEUE_KEY, JSON.stringify([bad]))

    rtl.render(<ActiveSync userId={USER} />)

    // Positive anchor FIRST: the push reached the route and was refused there.
    await rtl.waitFor(() => expect(served).toContain('POST /api/sync/batch 200'), {
      timeout: 15_000,
    })
    await rtl.waitFor(
      () => {
        const text = alerts().join(' | ')
        expect(text).toMatch(/Emergency fund/)
        expect(text).toMatch(/savings/)
        expect(text).toMatch(/couldn.t be saved to your account/)
        expect(text).toMatch(/being changed back to what your account has/)
      },
      { timeout: 15_000 }
    )
    // Positive anchor: the push really reached the route and was refused there.
    expect(served).toContain('POST /api/sync/batch 200')
    const [row] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, GOAL))
    expect(row?.currentBalance).toBe(1000)

    // THE REVERT: this device holds the server's value again.
    await rtl.waitFor(
      () => {
        const goal = useSavingsStore.getState().savingsGoals.find((g) => g.id === GOAL)
        expect(goal?.currentBalance).toBe(1000)
      },
      { timeout: 15_000 }
    )
    expect(persistedQueue()).toEqual([])
  }, 60_000)

  it('names a refused CREATE, removes the row locally, drops its queued edits and queues NO delete', async () => {
    const NEW = '50000000-0000-4000-8000-0000000000c2'
    useSavingsStore.setState({
      savingsGoals: [
        localGoal(GOAL, 'Emergency fund', 1000),
        { ...localGoal(NEW, 'Holiday', -1), sortOrder: 1 },
      ] as never,
    })
    const create = queuedOp({
      type: 'create',
      entityId: NEW,
      data: { userId: USER, name: 'Holiday', currentBalance: -1 },
    })
    const followUp = queuedOp({
      entityId: NEW,
      data: { userId: USER, name: 'Holiday', currentBalance: -1 },
      timestamp: create.timestamp + 1,
    })
    localStorage.setItem(QUEUE_KEY, JSON.stringify([create, followUp]))

    rtl.render(<ActiveSync userId={USER} />)

    await rtl.waitFor(
      () => {
        const text = alerts().join(' | ')
        expect(text).toMatch(/Holiday/)
        expect(text).toMatch(/removed from this device/)
      },
      { timeout: 15_000 }
    )
    expect(served).toContain('POST /api/sync/batch 200')
    // One notice for the ROW, not one per op.
    expect(alerts().filter((t) => /Holiday/.test(t))).toHaveLength(1)
    expect(useSavingsStore.getState().savingsGoals.map((g) => g.id)).toEqual([GOAL])

    // Let any bridge echo (a queued delete for the never-created row) surface.
    await new Promise((r) => setTimeout(r, 2500))
    expect(persistedQueue()).toEqual([])
    const sentTypes = pushed.flatMap((body) =>
      body.operations.map((o) => `${o.type}:${o.entityId}`)
    )
    expect(sentTypes).not.toContain(`delete:${NEW}`)
    const rows = await db.select().from(savingsGoals).where(eq(savingsGoals.id, NEW))
    expect(rows).toEqual([])
  }, 60_000)

  it('a refused DELETE restores the row from the server and uses a fallback name (the row is gone locally)', async () => {
    // The user deleted the goal on this device; the server still has it.
    useSavingsStore.setState({ savingsGoals: [] as never })
    // `data` without `userId` fails the server's request schema ("Delete
    // operations require userId") — a request-level 400, which core drops.
    const bad = queuedOp({ type: 'delete', data: {} })
    localStorage.setItem(QUEUE_KEY, JSON.stringify([bad]))

    rtl.render(<ActiveSync userId={USER} />)

    await rtl.waitFor(
      () => {
        const text = alerts().join(' | ')
        expect(text).toMatch(/A savings entry/i)
        expect(text).toMatch(/being restored from your account/)
      },
      { timeout: 15_000 }
    )
    expect(served).toContain('POST /api/sync/batch 400')
    // Never an empty quote pair or "undefined".
    expect(alerts().join(' ')).not.toMatch(/“”|""|undefined/)
    await rtl.waitFor(
      () => {
        expect(useSavingsStore.getState().savingsGoals.map((g) => g.id)).toEqual([GOAL])
      },
      { timeout: 15_000 }
    )
  }, 60_000)

  // Keyboard activation is proven by the component test (`RefusedEditNotice.test.tsx`,
  // `user.keyboard('{Enter}')`); jsdom's `fireEvent.keyDown` does not activate a
  // button, so this chain test only claims what a click proves (code review 75.2).
  it('a notice raised by a real refusal can be dismissed', async () => {
    useSavingsStore.setState({ savingsGoals: [localGoal(GOAL, 'Emergency fund', -1)] as never })
    localStorage.setItem(QUEUE_KEY, JSON.stringify([queuedOp({})]))

    rtl.render(<ActiveSync userId={USER} />)

    const button = await rtl.waitFor(
      () => {
        const found = Array.from(document.querySelectorAll('button')).find((b) =>
          /^Dismiss notice about .*Emergency fund/.test(b.getAttribute('aria-label') ?? '')
        )
        expect(found).toBeDefined()
        return found as HTMLButtonElement
      },
      { timeout: 15_000 }
    )
    expect(served).toContain('POST /api/sync/batch 200')
    rtl.fireEvent.click(button)

    await rtl.waitFor(() => expect(alerts().join(' ')).not.toMatch(/Emergency fund/))
  }, 60_000)

  it('tearing the sync down (sign-out, account switch) clears undismissed notices, so the next session never shows them', async () => {
    useSavingsStore.setState({ savingsGoals: [localGoal(GOAL, 'Emergency fund', -1)] as never })
    localStorage.setItem(QUEUE_KEY, JSON.stringify([queuedOp({})]))
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(() => expect(alerts().join(' ')).toMatch(/Emergency fund/), {
      timeout: 15_000,
    })

    // Sign-out: the sync engine unmounts with the notice still undismissed.
    rtl.cleanup()
    resetSyncStore()
    // The next paid session mounts in the same tab.
    rtl.render(<ActiveSync userId={USER} />)
    // Positive anchor: the new session is live (it pulled).
    const pullsBefore = served.filter((r) => r.startsWith('GET')).length
    await rtl.waitFor(
      () => expect(served.filter((r) => r.startsWith('GET')).length).toBeGreaterThan(pullsBefore),
      { timeout: 15_000 }
    )
    expect(alerts().join(' ')).not.toMatch(/Emergency fund/)
  }, 60_000)
})
