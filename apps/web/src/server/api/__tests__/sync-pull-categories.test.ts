import { Column, getTableName } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queriedTables: string[] = []
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

/** Walks drizzle's queryChunks to collect every `table.column` a WHERE clause references. */
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

    expect(queriedTables).toContain('categories')
  })

  it("emits each category as a ServerChange with entityType 'category'", async () => {
    const changes = await getSyncChanges('u1', null, 500, 'p1')

    const categoryChanges = changes.filter((c) => c.entityType === 'category')
    expect(categoryChanges).toHaveLength(1)
    expect(categoryChanges[0]?.entityId).toBe('cat-1')
    expect(categoryChanges[0]?.data).toMatchObject({ name: 'Groceries', kind: 'expense' })
    expect(categoryChanges[0]?.isDeleted).toBe(false)
    expect(categoryChanges[0]?.updatedAt).toBe(new Date('2026-01-02T00:00:00Z').getTime())
  })

  it('does NOT pull categories when no profile is active (they are profile-scoped)', async () => {
    await getSyncChanges('u1', null, 500, undefined)

    expect(queriedTables).not.toContain('categories')
  })

  it('scopes the pull to the session user — a missing userId clause leaks across accounts', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    const where = callFor('categories', 'where')
    expect(where).toBeDefined()
    expect(referencedColumns(where?.arg)).toContain('categories.userId')
  })

  it('scopes the pull to the active profile', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    expect(referencedColumns(callFor('categories', 'where')?.arg)).toContain('categories.profileId')
  })

  it('filters incrementally by updatedAt when a since timestamp is given', async () => {
    await getSyncChanges('u1', Date.UTC(2026, 0, 1, 12), 500, 'p1')

    expect(referencedColumns(callFor('categories', 'where')?.arg)).toContain('categories.updatedAt')
  })

  it('omits the updatedAt filter on a full (since-less) pull', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    expect(referencedColumns(callFor('categories', 'where')?.arg)).not.toContain(
      'categories.updatedAt'
    )
  })

  it('orders by updatedAt ASCENDING so pagination cannot skip rows', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    const orderBy = callFor('categories', 'orderBy')
    expect(referencedColumns(orderBy?.arg)).toContain('categories.updatedAt')
    expect(sqlFragments(orderBy?.arg).join(' ')).toMatch(/\basc\b/i)
  })

  it('applies the caller-supplied row cap, over-fetched by one (Story 53.1, AC-3)', async () => {
    await getSyncChanges('u1', null, 500, 'p1')

    // LIMIT is cappedLimit + 1: the extra row lets the per-table boundary trim
    // detect a cut-off timestamp group and defer it to the next pull.
    expect(callFor('categories', 'limit')?.arg).toBe(501)
  })
})
