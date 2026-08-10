/**
 * getSyncChanges must emit categories (Story 30.4a, AC-6 gate 10)
 *
 * ⚠️ WHY THIS FILE EXISTS. `getSyncChanges` is not table-driven — it is a series
 * of hand-written per-entity blocks, each doing its own `db.select().from(...)`
 * and pushing a hard-coded `entityType` string. A new FIELD rides along for free
 * (select() returns the whole row), but a new ENTITY never reaches a second
 * device unless a block is added by hand, and nothing fails when it is missed:
 * the data simply never arrives.
 *
 * Deleting the categories block was mutation-tested and left the ENTIRE server
 * suite green (201 passed) before this file existed. That is the gap it closes.
 *
 * ⚠️ CODE REVIEW 30.4a — the mock used to be `where: () => chain`, discarding its
 * argument. That made the file blind to every mutation of the query's SEMANTICS
 * while still "covering" the block. Verified at review: deleting
 * `eq(categories.userId, userId)` — the clause that stops one account's
 * categories reaching another — left the whole server suite green at 204/204.
 * The mock below now CAPTURES each call, so the scoping, the incremental filter
 * and the ordering are all asserted rather than assumed.
 *
 * The db module is mocked at the query-builder level so this runs with no
 * PostgreSQL: each `.from(table)` records the table and returns its fixture rows.
 */

import { Column, getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queriedTables: string[] = []
/** Every builder call, tagged with the table it was made against. */
const calls: { table: string; method: 'where' | 'orderBy' | 'limit'; arg: unknown }[] = []

vi.mock('@budget-planner/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>

  const rowsFor = (name: string): Record<string, unknown>[] => {
    if (name === 'categories') {
      return [
        {
          id: 'cat-1',
          userId: 'u1',
          profileId: 'p1',
          name: 'Groceries',
          kind: 'expense',
          isDeleted: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
        },
      ]
    }
    return []
  }

  const builder = (table: unknown) => {
    // Resolved lazily against the real table exports, so a renamed export fails loudly.
    const name = getTableName(table as Parameters<typeof getTableName>[0])
    queriedTables.push(name)
    const rows = rowsFor(name)
    const chain = {
      where: (arg: unknown) => {
        calls.push({ table: name, method: 'where', arg })
        return chain
      },
      orderBy: (arg: unknown) => {
        calls.push({ table: name, method: 'orderBy', arg })
        return chain
      },
      limit: async (arg: unknown) => {
        calls.push({ table: name, method: 'limit', arg })
        return rows
      },
    }
    return chain
  }

  return {
    ...actual,
    db: { select: () => ({ from: builder }) },
  }
})

const { getSyncChanges } = await import('../sync')

/**
 * Walk a drizzle SQL tree and collect every `table.column` it references.
 *
 * `eq(col, v)` yields chunks `[Column, ' = ', Param]`; `and(a, b)` nests further
 * SQL objects. Recursing over `queryChunks` therefore reveals exactly which
 * columns a WHERE clause constrains — which is the thing a discarded argument
 * hid, and the thing these tests need to assert.
 */
function referencedColumns(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') {
    return out
  }
  if (node instanceof Column) {
    out.push(`${getTableName(node.table)}.${node.name}`)
    return out
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      referencedColumns(chunk, out)
    }
  }
  return out
}

/** The literal SQL fragments in a tree (e.g. ' asc'), for ordering assertions. */
function sqlFragments(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') {
    return out
  }
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (typeof chunk === 'string') {
        out.push(chunk)
      } else if (chunk && typeof chunk === 'object' && 'value' in chunk) {
        const value = (chunk as { value: unknown }).value
        if (Array.isArray(value)) {
          out.push(...value.filter((v): v is string => typeof v === 'string'))
        }
      }
      sqlFragments(chunk, out)
    }
  }
  return out
}

const callFor = (table: string, method: 'where' | 'orderBy' | 'limit') =>
  calls.find((call) => call.table === table && call.method === method)

beforeEach(() => {
  queriedTables.length = 0
  calls.length = 0
})

describe('getSyncChanges — the categories block (gate 10)', () => {
  it('queries the categories table for a profile-scoped pull', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    // Remove the block from getSyncChanges and this goes red — the table is
    // never touched, so no category ever reaches a second device.
    expect(queriedTables).toContain('categories')
  })

  it("emits each category as a ServerChange with entityType 'category'", async () => {
    const changes = await getSyncChanges('u1', null, 500, 'p1')

    const categoryChanges = changes.filter((c) => c.entityType === 'category')
    expect(categoryChanges).toHaveLength(1)
    expect(categoryChanges[0]?.entityId).toBe('cat-1')
    // The whole row travels as `data`, which is how `kind` reaches the other
    // device without any per-field mapping on the pull side.
    expect(categoryChanges[0]?.data).toMatchObject({ name: 'Groceries', kind: 'expense' })
    expect(categoryChanges[0]?.isDeleted).toBe(false)
    expect(categoryChanges[0]?.updatedAt).toBe(new Date('2026-01-02T00:00:00Z').getTime())
  })

  it('does NOT pull categories when no profile is active (they are profile-scoped)', async () => {
    // Categories live inside the `if (profileId !== undefined)` guard alongside
    // the other profile-scoped entities — unlike userProfiles, which is
    // user-scoped and always pulled.
    await getSyncChanges('u1', null, 500, undefined)

    expect(queriedTables).not.toContain('categories')
  })

  // ── Query SEMANTICS ────────────────────────────────────────────────────────
  // Each assertion below names the exact mutation it kills. Before this block
  // existed, every one of these mutations left the server suite fully green.

  it('scopes the pull to the session user — a missing userId clause leaks across accounts', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    const where = callFor('categories', 'where')
    expect(where).toBeDefined()
    // MUTATION KILLED: delete `eq(categories.userId, userId)`. Verified green at
    // 204/204 before this assertion existed. This is cross-account isolation.
    expect(referencedColumns(where?.arg)).toContain('categories.userId')
  })

  it('scopes the pull to the active profile', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    // MUTATION KILLED: delete `eq(categories.profileId, profileId)` — one
    // profile's categories would surface in another.
    expect(referencedColumns(callFor('categories', 'where')?.arg)).toContain('categories.profileId')
  })

  it('filters incrementally by updatedAt when a since timestamp is given', async () => {
    await getSyncChanges('u1', Date.UTC(2026, 0, 1, 12), 500, 'p1')

    // MUTATION KILLED: drop the `gt(categories.updatedAt, sinceDate)` term.
    // Without it every delta pull silently becomes a full resync.
    expect(referencedColumns(callFor('categories', 'where')?.arg)).toContain('categories.updatedAt')
  })

  it('omits the updatedAt filter on a full (since-less) pull', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    // The negative control for the test above: proves that assertion is keyed on
    // the `since` argument and not simply always true.
    expect(referencedColumns(callFor('categories', 'where')?.arg)).not.toContain(
      'categories.updatedAt'
    )
  })

  it('orders by updatedAt ASCENDING so pagination cannot skip rows', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    const orderBy = callFor('categories', 'orderBy')
    // MUTATION KILLED: swap `asc` for `desc`. With descending order a paginated
    // delta pull walks away from the cursor and silently drops rows.
    expect(referencedColumns(orderBy?.arg)).toContain('categories.updatedAt')
    expect(sqlFragments(orderBy?.arg).join(' ')).toMatch(/\basc\b/i)
  })

  it('applies the caller-supplied row cap', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    // MUTATION KILLED: ignore `cappedLimit`, or hard-code a different value.
    expect(callFor('categories', 'limit')?.arg).toBe(500)
  })
})
