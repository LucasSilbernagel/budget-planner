/**
 * Category sync contract — POST-VALIDATION payload (Story 30.4a, AC-5)
 *
 * ⚠️ THIS FILE EXISTS BECAUSE NOTHING ELSE COVERS THIS GATE.
 *
 * `syncOperationDataSchema` (packages/core/src/sync/types.ts) is a flat zod
 * object of every field across every entity, and `validateOperationData` in
 * synchronization.ts does `schema.parse(data)` whose RESULT BECOMES the queued
 * payload. Zod strips unknown keys by default, so a field that
 * `toServerPayload` forwards but the schema does not declare is **silently
 * deleted at queue time — no error, no log**.
 *
 * The existing tests cannot see this:
 *  - syncBridge.test.ts mocks the queue handle, so validateOperationData never
 *    runs at all;
 *  - push-integration.dom.test.ts drives the real service but asserts with
 *    `toMatchObject` on the ENVELOPE (type/entityType/entityId/userId), never on
 *    `operations[0].data`.
 *
 * So these tests drive the REAL core service with only `fetch` stubbed and
 * assert the payload that actually goes on the wire, AFTER validation. Delete
 * `categoryId` or `kind` from syncOperationDataSchema and these go red while
 * every other suite stays green.
 */

// ⚠️ Import from the BARREL, not the `/sync` subpath (code review 30.4a).
// Story 30.4a rewrote two production imports off that subpath precisely because
// it does not resolve for the type-checker; leaving this file on it would type
// `service` as `any`, so the `queueCreate('category', …)` calls below — the
// whole point of this contract test — would be checked against nothing.
import { createSynchronizationService } from '@budget-planner/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendSyncOperation } from '../../../features/api/client'

const USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CATEGORY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function ok(): Response {
  return new Response(
    JSON.stringify({ success: true, processedCount: 1, failedCount: 0, conflictCount: 0 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

let service: ReturnType<typeof createSynchronizationService>

/** The `data` payload of the single operation in the POSTed batch. */
function sentData(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
  const body = JSON.parse((init?.body as string) ?? '{}')
  return body.operations[0].data as Record<string, unknown>
}

beforeEach(async () => {
  localStorage.clear()
  service = createSynchronizationService(USER_ID, {
    autoSync: false,
    processOperation: sendSyncOperation,
    profileId: 'profile-1',
  })
  await service.initialize()
})

afterEach(() => {
  service.destroy()
  vi.unstubAllGlobals()
})

describe('category sync contract — the payload AFTER syncOperationDataSchema', () => {
  it('AC-5: a cashflow row keeps its categoryId through the queue gate', async () => {
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)

    await service.queueCreate(
      'incomeSource',
      ROW_ID,
      {
        name: 'Salary',
        amount: 500000,
        frequency: 'monthly',
        categoryId: CATEGORY_ID,
        userId: USER_ID,
      },
      USER_ID
    )
    await service.forceSync()

    // The concrete id must survive — not merely "a categoryId key exists".
    expect(sentData(fetchMock).categoryId).toBe(CATEGORY_ID)
  })

  it('AC-5: an explicit null categoryId survives — un-categorizing must propagate', async () => {
    // This is the case a `.optional()`-without-`.nullable()` schema would reject
    // outright (ZodError at the queue gate), and that an omit-when-null bridge
    // would silently turn into "leave the previous category" server-side, since
    // updateEntity does a PARTIAL .set(). Both failure modes are invisible
    // without this assertion.
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)

    await service.queueUpdate(
      'expense',
      ROW_ID,
      { name: 'Rent', amount: 150000, frequency: 'monthly', categoryId: null, userId: USER_ID },
      USER_ID
    )
    await service.forceSync()

    const data = sentData(fetchMock)
    expect(data).toHaveProperty('categoryId')
    expect(data.categoryId).toBeNull()
  })

  it('AC-5: a category entity keeps its name and kind through the queue gate', async () => {
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)

    await service.queueCreate(
      'category',
      CATEGORY_ID,
      { name: 'Groceries', kind: 'expense', userId: USER_ID },
      USER_ID
    )
    await service.forceSync()

    const data = sentData(fetchMock)
    expect(data.name).toBe('Groceries')
    // `kind` is what separates the income and expense namespaces. Strip it and
    // every synced category becomes unplaceable server-side.
    expect(data.kind).toBe('expense')
  })

  it('AC-5: the category entity type reaches the wire intact', async () => {
    // `entityType` travels on the ENVELOPE, not in `data`, and is gated by a
    // separate hard-coded z.enum server-side (syncOperationSchema). This asserts
    // the client half; the server half is covered in sync-category-gates.test.ts.
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)

    await service.queueCreate(
      'category',
      CATEGORY_ID,
      { name: 'Groceries', kind: 'expense', userId: USER_ID },
      USER_ID
    )
    await service.forceSync()

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const body = JSON.parse((init?.body as string) ?? '{}')
    expect(body.operations[0].entityType).toBe('category')
  })

  it('a genuinely unknown field is still stripped — the gate is narrowed, not disabled', async () => {
    // GREEN NEGATIVE CONTROL. Widening syncOperationDataSchema must not turn it
    // into a passthrough: if this ever fails, someone "fixed" a stripped field by
    // loosening the schema (e.g. .passthrough()) rather than declaring the field,
    // and the gate protects nothing any more.
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)

    await service.queueCreate(
      'incomeSource',
      ROW_ID,
      {
        name: 'Salary',
        amount: 500000,
        frequency: 'monthly',
        userId: USER_ID,
        totallyUndeclaredField: 'should not reach the server',
      },
      USER_ID
    )
    await service.forceSync()

    expect(sentData(fetchMock)).not.toHaveProperty('totallyUndeclaredField')
  })
})
