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

const USER = '11111111-1111-4111-8111-111111111111'

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
let useIncomeStore: typeof import('@/stores/incomeStore').useIncomeStore
let useProfileStore: typeof import('@/stores/profileStore').useProfileStore
let ActiveSync: typeof import('../ActiveSync').ActiveSync

// vitest runs with cwd = apps/web.
const MIGRATIONS = resolve(process.cwd(), '../../packages/db/migrations')
const requests: string[] = []
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
    return batchPOST({ request })
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
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'Node',
    'navigator',
    'MutationObserver',
  ]) {
    vi.stubGlobal(
      key,
      key === 'window' ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]
    )
  }
  rtl = await import('@testing-library/react')
  ;({ resetSyncStore } = await import('@/hooks/useSync'))
  ;({ useIncomeStore } = await import('@/stores/incomeStore'))
  ;({ useProfileStore } = await import('@/stores/profileStore'))
  ;({ ActiveSync } = await import('../ActiveSync'))
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
})
