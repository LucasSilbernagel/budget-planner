// @vitest-environment node
/**
 * Two-device sync simulation against real PostgreSQL (PGlite).
 *
 * Runs the REAL client engine (ActiveSync → useSync → core SynchronizationService
 * → syncBridge → stores) against the REAL `/api/sync/batch` and
 * `/api/sync/changes` route handlers, with only the session lookup and rate
 * limiter stubbed. Device A enters data, device B (empty localStorage, fresh
 * stores) signs in to the same account and must see it.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))
/** Who the session cookie names (story 86.3 switches accounts on one browser). */
const session = vi.hoisted(() => ({ userId: '11111111-1111-4111-8111-111111111111' }))

// The real package entry refuses to load under jsdom (it has a `window`), so
// mock it from the schema module alone.
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

const USER = '11111111-1111-4111-8111-111111111111'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(async () => ({
    success: true,
    data: { userId: session.userId, subscriptionStatus: 'lifetime', isAuthenticated: true },
  })),
}))

import { POST as batchPOST } from '@/routes/api/sync/batch'
import { GET as changesGET } from '@/routes/api/sync/changes'
import { users } from '@budget-planner/db'
import { JSDOM } from 'jsdom'

type RTL = typeof import('@testing-library/react')
let rtl: RTL
let resetSyncStore: typeof import('@/hooks/useSync').resetSyncStore
let useIncomeStore: typeof import('@/stores/incomeStore').useIncomeStore
let useProfileStore: typeof import('@/stores/profileStore').useProfileStore
let ActiveSync: typeof import('../ActiveSync').ActiveSync
let useProfileManager: typeof import('@/hooks/useActiveProfile').useProfileManager

// vitest runs with cwd = apps/web.
const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const requests: string[] = []
/** Every op `/api/sync/batch` did not apply, with how the server answered. */
const batchFailures: string[] = []
/** Every statement PostgreSQL refused, as `SQLSTATE message`. */
const dbErrors: string[] = []
// When true, /api/sync/batch behaves like production BEFORE the profileId fix:
// every op comes back as a permanent (non-retryable) server failure.
let serverRejectsPushes = false

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://app.test')
  const request = new Request(url, init)
  requests.push(`${request.method} ${url.pathname}${url.search}`)
  if (url.pathname === '/api/sync/batch') {
    if (serverRejectsPushes) {
      return new Response(
        JSON.stringify({ success: false, processedCount: 0, failedCount: 1, conflictCount: 0 }),
        { status: 200 }
      )
    }
    const { operations } = (await request.clone().json()) as {
      operations: { type: string; entityType: string; entityId: string; profileId?: string }[]
    }
    const response = await batchPOST({ request })
    const body = (await response.clone().json()) as {
      failedCount?: number
      rejections?: unknown[]
    }
    if (!response.ok || (body.failedCount ?? 0) > 0) {
      const outcome = !response.ok
        ? `HTTP ${response.status}`
        : body.rejections?.length
          ? 'refused'
          : 'failed with no rejection (kept queued)'
      for (const op of operations) {
        batchFailures.push(
          `${op.type} ${op.entityType} ${op.entityId} (profile ${op.profileId}): ${outcome}`
        )
      }
    }
    return response
  }
  if (url.pathname === '/api/sync/changes') {
    return changesGET({ request })
  }
  throw new Error(`unrouted fetch ${url}`)
}

let pg: PGlite

beforeAll(async () => {
  // PGlite cannot boot under jsdom (its browser loader needs a real fetch/Blob),
  // so this file runs in the node environment and a DOM is installed only
  // after the database is up.
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
  // Record what the database refused (story 86.3: the 23505 a re-upload hits),
  // inside a transaction as well as out of one.
  const recording = <Q extends (...args: never[]) => Promise<unknown>>(query: Q): Q =>
    (async (...args: Parameters<Q>) => {
      try {
        return await query(...args)
      } catch (error) {
        const { code, message } = error as { code?: string; message?: string }
        dbErrors.push(`${code} ${message}`)
        throw error
      }
    }) as Q
  pg.query = recording(pg.query.bind(pg))
  const transaction = pg.transaction.bind(pg)
  pg.transaction = ((callback: Parameters<typeof pg.transaction>[0]) =>
    transaction((tx) => {
      tx.query = recording(tx.query.bind(tx))
      return callback(tx)
    })) as typeof pg.transaction
  const db = drizzle(pg)
  holder.db = db
  // An account that predates story 5-3: no profile row yet.
  await db.insert(users).values({
    id: USER,
    email: 'a@example.test',
    paddleId: 'ctm_a',
    subscriptionStatus: 'lifetime',
  })
  vi.stubGlobal('fetch', routeFetch)

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
  // ⚠️ `localStorage` MUST come from the JSDOM window. The node environment has
  // none, on every Node (`src/test/webstorage.ts` removes newer Node's own).
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
  // Persisted stores bind their storage when their module is first evaluated,
  // and `vitest.setup.ts` imports several of them before this hook installs the
  // JSDOM `localStorage`. Under the node environment there was no storage to
  // bind (`src/test/webstorage.ts`), so a store may have no `persist` API.
  // Rebind whichever have one.
  const { createJSONStorage } = await import('zustand/middleware')
  const persisted = await Promise.all([
    import('@/stores/incomeStore').then((m) => m.useIncomeStore),
    import('@/stores/expenseStore').then((m) => m.useExpenseStore),
    import('@/stores/savingsStore').then((m) => m.useSavingsStore),
    import('@/stores/balanceStore').then((m) => m.useBalanceStore),
    import('@/stores/categoryStore').then((m) => m.useCategoryStore),
    import('@/stores/currencyStore').then((m) => m.useCurrencyStore),
    import('@/stores/profileStore').then((m) => m.useProfileStore),
    import('@/stores/overviewDurationStore').then((m) => m.useOverviewDurationStore),
    import('@/stores/plannerVisibilityStore').then((m) => m.usePlannerVisibilityStore),
    import('@/stores/tableSortStore').then((m) => m.useTableSortStore),
    import('@/stores/retirementPlannerStore').then((m) => m.useRetirementPlannerStore),
  ])
  for (const store of persisted) {
    const api = (store as { persist?: { setOptions: (o: Record<string, unknown>) => void } })
      .persist
    api?.setOptions({
      storage: createJSONStorage(() => dom.window.localStorage),
    })
  }

  rtl = await import('@testing-library/react')
  ;({ resetSyncStore } = await import('@/hooks/useSync'))
  ;({ useIncomeStore } = await import('@/stores/incomeStore'))
  ;({ useProfileStore } = await import('@/stores/profileStore'))
  ;({ ActiveSync } = await import('../ActiveSync'))
  ;({ useProfileManager } = await import('@/hooks/useActiveProfile'))
}, 60_000)

afterAll(async () => {
  vi.unstubAllGlobals()
  await pg?.close()
})

/** A page reload: React tree and in-memory engine gone, localStorage kept. */
function reload(): void {
  rtl.cleanup()
  resetSyncStore()
}

function freshDevice(): void {
  rtl.cleanup()
  resetSyncStore()
  localStorage.clear()
  const placeholder = crypto.randomUUID()
  useProfileStore.setState({
    profiles: [
      { id: placeholder, userId: '', name: 'Main Profile', isDefault: true, currency: 'NONE' },
    ],
    activeProfileId: placeholder,
  })
  useIncomeStore.setState({ incomeSources: [] })
}

describe('cross-device sync (real engine, real routes, real PostgreSQL)', () => {
  it('data entered on device A appears on device B', async () => {
    // Device A: data entered before sync mounts (free tier / pre-login), then sign in.
    freshDevice()
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Salary', amount: 500_000, frequency: 'monthly' })
    const localId = useIncomeStore.getState().incomeSources[0]?.id
    rtl.render(<ActiveSync userId={USER} />)

    await rtl.waitFor(
      async () => {
        const rows = await pg.query<{ id: string }>('select id from "incomeSources"')
        expect(rows.rows.map((r) => r.id)).toEqual([localId])
      },
      { timeout: 15_000 }
    )

    // Device A adds a second row while signed in.
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Bonus', amount: 100_000, frequency: 'annually' })
    await rtl.waitFor(
      async () => {
        const rows = await pg.query('select id from "incomeSources"')
        expect(rows.rows).toHaveLength(2)
      },
      { timeout: 15_000 }
    )

    // Device B: brand-new browser, same account.
    freshDevice()
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      () => {
        const names = useIncomeStore
          .getState()
          .incomeSources.map((s) => s.name)
          .sort()
        expect(names).toEqual(['Bonus', 'Salary'])
      },
      { timeout: 15_000 }
    )
  }, 60_000)

  it('a device whose uploads were rejected before the server fix uploads its data after a reload, with no new edits', async () => {
    await pg.exec('delete from "incomeSources"')
    freshDevice()
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Rent income', amount: 90_000, frequency: 'monthly' })
    serverRejectsPushes = true
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(() => expect(requests.some((r) => r.startsWith('POST'))).toBe(true), {
      timeout: 15_000,
    })
    await new Promise((r) => setTimeout(r, 500))

    // Deploy the fix, reload the page.
    serverRejectsPushes = false
    requests.length = 0
    reload()
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      async () => {
        const rows = await pg.query('select id from "incomeSources"')
        expect(rows.rows).toHaveLength(1)
      },
      { timeout: 15_000 }
    )
  }, 60_000)

  it('local rows are uploaded even when the device carries the pre-fix "already seeded" marker and no queued ops', async () => {
    await pg.exec('delete from "incomeSources"')
    freshDevice()
    // A reconciled device from before the fix: v1 seed marker set, queue gone.
    const serverProfile = await pg.query<{ id: string }>(
      `select id from "userProfiles" where "userId" = '${USER}' limit 1`
    )
    const profileId = serverProfile.rows[0]?.id as string
    useProfileStore.setState({
      profiles: [
        { id: profileId, userId: USER, name: 'Main Profile', isDefault: true, currency: 'NONE' },
      ],
      activeProfileId: profileId,
    })
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Pension', amount: 70_000, frequency: 'monthly' })
    localStorage.setItem(`budget-planner:sync-seeded:${USER}`, '1')

    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      async () => {
        const rows = await pg.query('select id from "incomeSources"')
        expect(rows.rows).toHaveLength(1)
      },
      { timeout: 15_000 }
    )
  }, 60_000)

  it('a profile created while sync was off is uploaded, so the data queued under it reaches the server and another device can switch to it', async () => {
    await pg.exec('delete from "incomeSources"')
    freshDevice()
    // Device A, as observed in production: its ACTIVE profile carries the user's
    // id but was never uploaded (created before the push bridge registered).
    const localOnlyProfile = crypto.randomUUID()
    useProfileStore.setState({
      profiles: [
        {
          id: localOnlyProfile,
          userId: USER,
          name: 'Household',
          isDefault: false,
          currency: 'NONE',
        },
      ],
      activeProfileId: localOnlyProfile,
    })
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Freelance', amount: 250_000, frequency: 'monthly' })

    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      async () => {
        const rows = await pg.query<{ profileId: string }>(
          'select "profileId" from "incomeSources"'
        )
        expect(rows.rows.map((r) => r.profileId)).toEqual([localOnlyProfile])
      },
      { timeout: 20_000 }
    )
    const profiles = await pg.query<{ id: string }>(
      `select id from "userProfiles" where "userId" = '${USER}' and "isDeleted" = false`
    )
    expect(profiles.rows.map((r) => r.id)).toContain(localOnlyProfile)

    // Device B: fresh, lands on the default profile, then switches to the uploaded one.
    freshDevice()
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      () => {
        expect(useProfileStore.getState().profiles.map((p) => p.id)).toContain(localOnlyProfile)
      },
      { timeout: 15_000 }
    )
    useProfileStore.getState().switchProfile(localOnlyProfile)
    await rtl.waitFor(
      () => {
        expect(useIncomeStore.getState().incomeSources.map((s) => s.name)).toContain('Freelance')
      },
      { timeout: 15_000 }
    )
  }, 90_000)
})

// ---------------------------------------------------------------------------
// Story 86.3: two ACCOUNTS on one browser (not two devices of one account).
// ---------------------------------------------------------------------------

const ACCOUNT_A = '86386386-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ACCOUNT_B = '86386386-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACCOUNT_C = '86386386-cccc-4ccc-8ccc-cccccccccccc'

/** The ops in `userId`'s persisted push queue, as `type entityType entityId`. */
function queued(userId: string): string[] {
  const ops = JSON.parse(localStorage.getItem(`bp-sync-queue-${userId}`) ?? '[]') as {
    type: string
    entityType: string
    entityId: string
  }[]
  return ops.map((op) => `${op.type} ${op.entityType} ${op.entityId}`)
}

/** Sign-out is a document load (`lib/account/sign-out.ts`): every store is KEPT. */
function signOut(): void {
  rtl.cleanup()
  resetSyncStore()
}

/** The local income row called `name` (`addIncomeSource` returns nothing). */
function incomeNamed(name: string): { id: string } {
  const row = useIncomeStore.getState().incomeSources.find((r) => r.name === name)
  if (!row) {
    throw new Error(`no local income row named ${name}`)
  }
  return row
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** `userId`'s server default profile id (the first pull backfills it). */
async function serverDefaultProfile(userId: string): Promise<string | undefined> {
  const rows = await pg.query<{ id: string }>(
    'select id from "userProfiles" where "userId" = $1 and "isDefault" = true and "isDeleted" = false',
    [userId]
  )
  return rows.rows[0]?.id
}

describe('two accounts on one browser (story 86.3, real engine, real routes, real PostgreSQL)', () => {
  beforeAll(async () => {
    const db = holder.db as ReturnType<typeof drizzle>
    await db.insert(users).values([
      {
        id: ACCOUNT_A,
        email: 'a863@example.test',
        paddleId: 'ctm_a863',
        subscriptionStatus: 'lifetime',
      },
      {
        id: ACCOUNT_B,
        email: 'b863@example.test',
        paddleId: 'ctm_b863',
        subscriptionStatus: 'lifetime',
      },
      {
        id: ACCOUNT_C,
        email: 'c863@example.test',
        paddleId: 'ctm_c863',
        subscriptionStatus: 'lifetime',
      },
    ])
  })

  afterEach(() => {
    session.userId = USER
  })

  it('AC 2: what A pushed and never pulled back is A’s, so B neither lands on it nor re-uploads it', async () => {
    // A signs in on a fresh browser and syncs.
    freshDevice()
    session.userId = ACCOUNT_A
    rtl.render(<ActiveSync userId={ACCOUNT_A} />)
    await rtl.waitFor(
      () => {
        const { profiles, activeProfileId } = useProfileStore.getState()
        expect(profiles.find((p) => p.id === activeProfileId)?.userId).toBe(ACCOUNT_A)
      },
      { timeout: 15_000 }
    )
    const aDefault = await serverDefaultProfile(ACCOUNT_A)
    expect(aDefault).toBeDefined()
    // Let the reconcile re-pull and the profile upload settle before A's edits.
    await sleep(500)
    const pullsBeforeEdits = requests.filter((r) => r.startsWith('GET')).length

    // A makes a profile on the Profiles page and adds an income row; both push.
    const manager = rtl.renderHook(() => useProfileManager())
    const side = manager.result.current.createProfile({
      name: 'Side',
      isDefault: false,
      currency: 'NONE',
      userId: 'temp-user',
    })
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'A salary', amount: 300_000, frequency: 'monthly' })
    const aIncome = incomeNamed('A salary')
    await rtl.waitFor(
      async () => {
        const profile = await pg.query<{ userId: string }>(
          'select "userId" from "userProfiles" where id = $1',
          [side.id]
        )
        expect(profile.rows).toEqual([{ userId: ACCOUNT_A }])
        const income = await pg.query<{ userId: string }>(
          'select "userId" from "incomeSources" where id = $1',
          [aIncome.id]
        )
        expect(income.rows).toEqual([{ userId: ACCOUNT_A }])
        // The client processed the responses: nothing of A's is still queued,
        expect(queued(ACCOUNT_A)).toEqual([])
        // and the accepted pushes marked both local rows as A's (86.3, AC 1).
        expect(useProfileStore.getState().profiles.find((p) => p.id === side.id)?.userId).toBe(
          ACCOUNT_A
        )
        expect(
          useIncomeStore.getState().incomeSources.find((r) => r.id === aIncome.id)?.userId
        ).toBe(ACCOUNT_A)
      },
      { timeout: 15_000 }
    )
    // Precondition: A signs out before any pull brought those rows back.
    expect(requests.filter((r) => r.startsWith('GET')).length).toBe(pullsBeforeEdits)
    signOut()

    // B signs in on the same browser.
    session.userId = ACCOUNT_B
    batchFailures.length = 0
    dbErrors.length = 0
    rtl.render(<ActiveSync userId={ACCOUNT_B} />)
    await rtl.waitFor(
      () => expect(useProfileStore.getState().profiles.map((p) => p.userId)).toContain(ACCOUNT_B),
      { timeout: 15_000 }
    )
    const bDefault = await serverDefaultProfile(ACCOUNT_B)
    expect(bDefault).toBeDefined()
    // Long enough for the profile upload's push (`syncSoon`, 2 s debounce) and
    // the seed to go out and come back.
    await sleep(3500)

    const { profiles, activeProfileId } = useProfileStore.getState()
    expect.soft(profiles.map((p) => p.id)).not.toContain(side.id)
    expect.soft(activeProfileId).toBe(bDefault)
    expect.soft(useIncomeStore.getState().incomeSources.map((r) => r.id)).not.toContain(aIncome.id)
    expect.soft(queued(ACCOUNT_B)).toEqual([])
    expect.soft(batchFailures).toEqual([])
    expect.soft(dbErrors).toEqual([])

    // B's own edit lands in B's account, under B's profile.
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'B salary', amount: 200_000, frequency: 'monthly' })
    const bIncome = incomeNamed('B salary')
    const landed = async () =>
      (
        await pg.query<{ userId: string; profileId: string }>(
          'select "userId", "profileId" from "incomeSources" where id = $1',
          [bIncome.id]
        )
      ).rows
    await rtl
      .waitFor(async () => expect(await landed()).toHaveLength(1), { timeout: 6000 })
      .catch(() => undefined)
    expect.soft(await landed()).toEqual([{ userId: ACCOUNT_B, profileId: bDefault }])
    // A's rows are untouched on the server.
    const aRows = await pg.query<{ userId: string }>(
      'select "userId" from "userProfiles" where id = $1 union all select "userId" from "incomeSources" where id = $2',
      [side.id, aIncome.id]
    )
    expect(aRows.rows).toEqual([{ userId: ACCOUNT_A }, { userId: ACCOUNT_A }])
  }, 60_000)

  it('AC 5: what A never pushed is still adopted by the next account, and marked as theirs once it lands', async () => {
    // Made on the free tier (no push bridge): never pushed.
    freshDevice()
    const manager = rtl.renderHook(() => useProfileManager())
    const local = manager.result.current.createProfile({
      name: 'Local',
      isDefault: false,
      currency: 'NONE',
      userId: 'temp-user',
    })
    useIncomeStore
      .getState()
      .addIncomeSource({ name: 'Free salary', amount: 100_000, frequency: 'monthly' })
    const freeIncome = incomeNamed('Free salary')
    manager.unmount()

    session.userId = ACCOUNT_C
    rtl.render(<ActiveSync userId={ACCOUNT_C} />)
    // Both creates SUCCEED under C (D4 adoption).
    await rtl.waitFor(
      async () => {
        const profile = await pg.query<{ userId: string }>(
          'select "userId" from "userProfiles" where id = $1',
          [local.id]
        )
        expect(profile.rows).toEqual([{ userId: ACCOUNT_C }])
        const income = await pg.query<{ userId: string }>(
          'select "userId" from "incomeSources" where id = $1',
          [freeIncome.id]
        )
        expect(income.rows).toEqual([{ userId: ACCOUNT_C }])
        expect(queued(ACCOUNT_C)).toEqual([])
      },
      { timeout: 20_000 }
    )
    // ...and the local rows now say so.
    await rtl.waitFor(() => {
      expect(useProfileStore.getState().profiles.find((p) => p.id === local.id)?.userId).toBe(
        ACCOUNT_C
      )
      expect(
        useIncomeStore.getState().incomeSources.find((r) => r.id === freeIncome.id)?.userId
      ).toBe(ACCOUNT_C)
    })
  }, 60_000)
})
