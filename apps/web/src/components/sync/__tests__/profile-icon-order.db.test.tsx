// @vitest-environment node
/**
 * Profile icon + order round trip against real PostgreSQL (PGlite) (story 98.1,
 * FR159, AC 3-4).
 *
 * Harness COPIED from `cross-device-sync.db.test.tsx` (a NEW file on purpose, so
 * story 99.2 can extend that one without a merge conflict): the REAL client engine
 * (ActiveSync → useSync → core SynchronizationService → syncBridge → stores)
 * against the REAL `/api/sync/batch` and `/api/sync/changes` route handlers, over
 * PGlite with the full committed migration chain. Only the session lookup and the
 * rate limiter are stubbed.
 *
 * What it proves, end to end:
 * - a profile created through `useProfileManager().createProfile` (the call the
 *   create dialog makes) with an icon lands in `userProfiles.icon`, for a chosen
 *   icon AND for the untouched 🏠 default; a second, fresh device pulls both back;
 * - an icon CHANGED later (the edit dialog's update path) reaches the server and
 *   the other device too (the "other direction": there is no clear-icon
 *   affordance, and `toServerPayload` omits `null` by design);
 * - the second device reads profiles oldest → newest by the SERVER's `createdAt`,
 *   including after a pulled rename of the oldest moved it to the END of the store
 *   array (remove-then-append in `applyOne`).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ db: null as unknown }))

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

const USER = '98198198-1111-4111-8111-111111111111'

vi.mock('@/server/api/auth/paddle', () => ({
  getCurrentUserSession: vi.fn(async () => ({
    success: true,
    data: { userId: USER, subscriptionStatus: 'lifetime', isAuthenticated: true },
  })),
}))

import { POST as batchPOST } from '@/routes/api/sync/batch'
import { GET as changesGET } from '@/routes/api/sync/changes'
import { users } from '@budget-planner/db'
import { JSDOM } from 'jsdom'

type RTL = typeof import('@testing-library/react')
let rtl: RTL
let resetSyncStore: typeof import('@/hooks/useSync').resetSyncStore
let useProfileStore: typeof import('@/stores/profileStore').useProfileStore
let useProfiles: typeof import('@/stores/profileStore').useProfiles
let ActiveSync: typeof import('../ActiveSync').ActiveSync
let useProfileManager: typeof import('@/hooks/useActiveProfile').useProfileManager
let resolveProfileIcon: typeof import('@/lib/profile-appearance').resolveProfileIcon

// vitest runs with cwd = apps/web.
const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
/** Every op `/api/sync/batch` did not apply. */
const batchFailures: string[] = []

async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://app.test')
  const request = new Request(url, init)
  if (url.pathname === '/api/sync/batch') {
    const { operations } = (await request.clone().json()) as {
      operations: { type: string; entityType: string; entityId: string }[]
    }
    const response = await batchPOST({ request })
    const body = (await response.clone().json()) as { failedCount?: number }
    if (!response.ok || (body.failedCount ?? 0) > 0) {
      for (const op of operations) {
        batchFailures.push(`${op.type} ${op.entityType} ${op.entityId}: HTTP ${response.status}`)
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
  // PGlite cannot boot under jsdom, so this file runs in the node environment and
  // a DOM is installed only after the database is up.
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
  const db = drizzle(pg)
  holder.db = db
  // An account with no profile row yet: the first pull backfills its default.
  await db.insert(users).values({
    id: USER,
    email: 'p981@example.test',
    paddleId: 'ctm_p981',
    subscriptionStatus: 'lifetime',
  })
  vi.stubGlobal('fetch', routeFetch)

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://app.test/' })
  // ⚠️ `localStorage` MUST come from the JSDOM window (see the source harness).
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
  // Rebind every persisted store to the JSDOM storage (see the source harness).
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
  ;({ useProfileStore, useProfiles } = await import('@/stores/profileStore'))
  ;({ ActiveSync } = await import('../ActiveSync'))
  ;({ useProfileManager } = await import('@/hooks/useActiveProfile'))
  ;({ resolveProfileIcon } = await import('@/lib/profile-appearance'))
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
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

type IconRow = { id: string; name: string; icon: string | null }

async function serverRows(): Promise<IconRow[]> {
  const result = await pg.query<IconRow>(
    'select id, name, icon from "userProfiles" where "userId" = $1 and "isDeleted" = false order by "createdAt", id',
    [USER]
  )
  return result.rows
}

/** What a consumer reads: the `useProfiles()` hook, not the raw store array. */
function readNames(): string[] {
  const { result, unmount } = rtl.renderHook(() => useProfiles())
  const names = result.current.map((p) => p.name)
  unmount()
  return names
}

describe('profile icon + order round trip (story 98.1, real engine, real routes, real PostgreSQL)', () => {
  it('icons chosen on create (and changed later) reach the server and another device, which reads oldest → newest', async () => {
    // Device A signs in on a fresh browser; the first pull backfills the default.
    freshDevice()
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      () => {
        const { profiles, activeProfileId } = useProfileStore.getState()
        expect(profiles.find((p) => p.id === activeProfileId)?.userId).toBe(USER)
      },
      { timeout: 15_000 }
    )
    await sleep(500)

    // A creates "Work" with a CHOSEN icon, exactly as the create dialog calls it.
    const manager = rtl.renderHook(() => useProfileManager())
    const work = manager.result.current.createProfile({
      name: 'Work',
      icon: '💼',
      isDefault: false,
      currency: 'NONE',
      userId: 'temp-user',
    })
    await rtl.waitFor(
      async () => expect((await serverRows()).map((r) => r.name)).toContain('Work'),
      { timeout: 15_000 }
    )
    // Then "Travel" with the untouched pre-selection (🏠), strictly later.
    const travel = manager.result.current.createProfile({
      name: 'Travel',
      icon: '🏠',
      isDefault: false,
      currency: 'NONE',
      userId: 'temp-user',
    })
    await rtl.waitFor(
      async () => expect((await serverRows()).map((r) => r.name)).toContain('Travel'),
      { timeout: 15_000 }
    )

    // AC 3: the INSERT wrote both icons; the backfilled default has none.
    const rows = await serverRows()
    const defaultRow = rows[0] as IconRow
    expect(rows.map((r) => [r.name, r.icon])).toEqual([
      [defaultRow.name, null],
      ['Work', '💼'],
      ['Travel', '🏠'],
    ])
    expect(rows.map((r) => r.id)).toEqual([defaultRow.id, work.id, travel.id])
    expect(batchFailures).toEqual([])

    // Device B: brand-new browser, same account, pulls.
    freshDevice()
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      () => expect(useProfileStore.getState().profiles.map((p) => p.id)).toContain(travel.id),
      { timeout: 15_000 }
    )
    const onB = (id: string) => useProfileStore.getState().profiles.find((p) => p.id === id)
    expect(onB(work.id)?.icon).toBe('💼')
    expect(onB(travel.id)?.icon).toBe('🏠')
    // D1: the never-iconed server default renders 🏠 on B.
    expect(onB(defaultRow.id)?.icon ?? null).toBeNull()
    expect(resolveProfileIcon(onB(defaultRow.id) as NonNullable<ReturnType<typeof onB>>)).toBe('🏠')
    // AC 4: B reads by the SERVER's createdAt.
    expect(readNames()).toEqual([defaultRow.name, 'Work', 'Travel'])

    // Put device B aside (its storage AND its in-memory profile state; one test
    // process hosts every "device").
    await sleep(500)
    const bStorage = Object.entries({ ...localStorage }) as [string, string][]
    const { profiles: bProfiles, activeProfileId: bActive } = useProfileStore.getState()

    // Another device (fresh) renames the OLDEST profile and changes Work's icon
    // through the edit path.
    freshDevice()
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      () => expect(useProfileStore.getState().profiles.map((p) => p.id)).toContain(travel.id),
      { timeout: 15_000 }
    )
    await sleep(500)
    const managerA = rtl.renderHook(() => useProfileManager())
    managerA.result.current.modifyProfile(defaultRow.id, { name: 'Household' })
    managerA.result.current.modifyProfile(work.id, { icon: '📈' })
    await rtl.waitFor(
      async () => {
        const after = await serverRows()
        expect(after.map((r) => [r.name, r.icon])).toEqual([
          ['Household', null],
          ['Work', '📈'],
          ['Travel', '🏠'],
        ])
      },
      { timeout: 15_000 }
    )
    expect(batchFailures).toEqual([])

    // Device B again: a reload with its own storage and state restored, so the
    // pulled changes MERGE into its existing rows (`applyOne` remove-then-append).
    reload()
    localStorage.clear()
    for (const [key, value] of bStorage) {
      localStorage.setItem(key, value)
    }
    useProfileStore.setState({ profiles: bProfiles, activeProfileId: bActive })
    // Precondition: B starts this pull in oldest-first ARRAY order.
    expect(useProfileStore.getState().profiles.map((p) => p.id)).toEqual([
      defaultRow.id,
      work.id,
      travel.id,
    ])
    rtl.render(<ActiveSync userId={USER} />)
    await rtl.waitFor(
      () => {
        expect(onB(defaultRow.id)?.name).toBe('Household')
        expect(onB(work.id)?.icon).toBe('📈')
      },
      { timeout: 15_000 }
    )
    // Control: the pulled rename really moved the oldest away from the front of
    // the store ARRAY, so the order assertion below is not vacuous.
    expect(useProfileStore.getState().profiles[0]?.id).not.toBe(defaultRow.id)
    expect(readNames()).toEqual(['Household', 'Work', 'Travel'])
  }, 90_000)
})
