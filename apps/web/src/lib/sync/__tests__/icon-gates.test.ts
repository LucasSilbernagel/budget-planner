/** The server gate validates but doesn't strip: superRefine discards its parse result and `data` is a z.record. */

// Deep import: core's `sync` barrel doesn't re-export syncOperationDataSchema.
import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import {
  type SyncBridgeHandle,
  clearSyncBridge,
  registerSyncBridge,
  syncEntityCreate,
  syncEntityUpdate,
} from '../syncBridge'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'
const ROW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeHandle() {
  return {
    userId: SESSION_USER_ID,
    queueCreate: vi.fn<SyncBridgeHandle['queueCreate']>(async () => {}),
    queueUpdate: vi.fn<SyncBridgeHandle['queueUpdate']>(async () => {}),
    queueDelete: vi.fn<SyncBridgeHandle['queueDelete']>(async () => {}),
  }
}

let handle: ReturnType<typeof makeHandle>

beforeEach(() => {
  handle = makeHandle()
  registerSyncBridge(handle)
})

afterEach(() => {
  clearSyncBridge()
  vi.restoreAllMocks()
})

const profile = (extra: Record<string, unknown> = {}) => ({
  id: ROW_ID,
  name: 'Business',
  isDefault: false,
  currency: 'EUR',
  ...extra,
})

describe('Gate 1 — the push payload carries icon', () => {
  it('update forwards a chosen icon', () => {
    syncEntityUpdate('userProfile', profile({ icon: '✈️' }))
    expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
    const payload = handle.queueUpdate.mock.calls[0][2]
    expect(payload['icon']).toBe('✈️')
    expect(payload['name']).toBe('Business')
    expect(payload['currency']).toBe('EUR')
  })

  it('create forwards a chosen icon', () => {
    syncEntityCreate('userProfile', profile({ icon: '🎯' }))
    expect(handle.queueCreate).toHaveBeenCalledTimes(1)
    expect(handle.queueCreate.mock.calls[0][2]).toMatchObject({ icon: '🎯' })
  })

  /** Omitted when unset (unlike sortOrder): a partial .set() leaves the server value alone. */
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('omits the icon key entirely when it is %s', (_label, value) => {
    syncEntityUpdate('userProfile', profile({ icon: value }))
    const payload = handle.queueUpdate.mock.calls[0][2]
    expect(Object.hasOwn(payload, 'icon')).toBe(false)
  })
})

describe('Gate 2 — the client zod gate does not strip icon', () => {
  it('preserves icon through a parse', () => {
    const parsed = syncOperationDataSchema.parse({
      name: 'Business',
      currency: 'EUR',
      icon: '✈️',
      userId: SESSION_USER_ID,
    })
    expect(parsed.icon).toBe('✈️')
  })

  it('preserves an explicit null rather than rejecting it', () => {
    const parsed = syncOperationDataSchema.parse({ name: 'Business', icon: null })
    expect(Object.hasOwn(parsed, 'icon')).toBe(true)
    expect(parsed.icon).toBeNull()
  })

  it('DOES strip a genuinely undeclared key (so the check above is meaningful)', () => {
    const parsed = syncOperationDataSchema.parse({
      name: 'Business',
      notARealField: 'dropped',
    } as Record<string, unknown>)
    expect(Object.hasOwn(parsed, 'notARealField')).toBe(false)
  })

  it('rejects an over-long icon', () => {
    expect(() =>
      syncOperationDataSchema.parse({ name: 'Business', icon: 'x'.repeat(17) })
    ).toThrow()
  })
})

/** Without the declaration an over-long value would fail at the varchar(16) INSERT instead of the boundary. */
describe('Gate 3 — the server gate validates icon and keeps it in data', () => {
  const op = (data: Record<string, unknown>) => ({
    id: 'op-1',
    type: 'update' as const,
    entityType: 'userProfile' as const,
    entityId: ROW_ID,
    timestamp: 1_700_000_000_000,
    deviceId: 'device-1',
    userId: SESSION_USER_ID,
    data: { ...data, userId: SESSION_USER_ID },
  })

  const base = { name: 'Business', isDefault: false, currency: 'EUR' }

  /** Not discriminating alone (the gate doesn't strip); the rejection below pins the declaration. */
  it('accepts a valid icon and RETAINS it in data (not stripped)', () => {
    const parsed = syncOperationSchema.parse(op({ ...base, icon: '✈️' }))
    expect((parsed.data as Record<string, unknown>)['icon']).toBe('✈️')
  })

  it('accepts a profile with no icon at all', () => {
    expect(() => syncOperationSchema.parse(op(base))).not.toThrow()
  })

  it('accepts an explicit null icon', () => {
    expect(() => syncOperationSchema.parse(op({ ...base, icon: null }))).not.toThrow()
  })

  it('rejects an over-long icon', () => {
    expect(() => syncOperationSchema.parse(op({ ...base, icon: 'x'.repeat(17) }))).toThrow()
  })
})
