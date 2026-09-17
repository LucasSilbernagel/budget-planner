/**
 * `icon` sync-contract gates (Story 54.2, FR78, AC-2).
 *
 * A new FIELD on an EXISTING entity (`userProfile`) has to be declared at four
 * independent places, and the client-side ones fail SILENTLY if missed:
 *
 *   1. `syncOperationDataSchema` (packages/core/src/sync/types.ts) — STRIPS
 *      undeclared keys, so a forgotten line drops `icon` before the op is ever
 *      queued. No error, no rejection, a "successful" sync that discards the
 *      user's choice.
 *   2. `toServerPayload`'s `userProfile` case (syncBridge.ts) — an explicit
 *      whitelist returning `Record<string, unknown>`, so a forgotten key is not a
 *      type error and the field simply never leaves the browser.
 *   3. `userProfileSchema` (packages/core) and 4. its hand-maintained duplicate in
 *      server/api/sync.ts — these VALIDATE, they do not strip (see below).
 *
 * The pull direction needs no gate of its own: `getSyncChanges` selects whole rows
 * (`db.select()`), `updateEntity`/`createEntity` spread their input, and
 * `applyOne` spreads `change.data`. Those are asserted structurally in
 * `applyServerChanges.test.ts` rather than here.
 *
 * ⚠️ NOTHING HERE CLAIMS A LIVE ROUND-TRIP SUCCEEDS. These are contract tests.
 *
 * ⚠️ Inherited from `sort-order-gates.test.ts` and RE-VERIFIED here rather than
 * assumed: the server's per-entity `.parse()` runs inside `syncOperationSchema`'s
 * `superRefine`, and zod DISCARDS a superRefine callback's return value — only
 * raised issues survive. The operation's `data` is `z.record(z.unknown())` at the
 * top level, so it passes through UNSTRIPPED. The server gate therefore provides
 * VALIDATION, not stripping, and the tests below assert exactly that.
 */

// Deep import: `syncOperationDataSchema` is deliberately not re-exported from
// core's `sync` barrel, so the barrel path resolves to `undefined` and every
// assertion below would fail with "Cannot read properties of undefined".
import { syncOperationDataSchema } from '@budget-planner/core/sync/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOperationSchema } from '../../../server/api/sync'
import {
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
    queueCreate: vi.fn(async () => {}),
    queueUpdate: vi.fn(async () => {}),
    queueDelete: vi.fn(async () => {}),
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

/**
 * GATE 1 — `toServerPayload` (syncBridge.ts).
 *
 * MUTATION KILLED (M5): delete `icon` from the `userProfile` branch.
 */
describe('Gate 1 — the push payload carries icon', () => {
  it('update forwards a chosen icon', () => {
    syncEntityUpdate('userProfile', profile({ icon: '✈️' }))
    expect(handle.queueUpdate).toHaveBeenCalledTimes(1)
    const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(payload['icon']).toBe('✈️')
    // The rest of the profile still rides along — a new field must not displace
    // the existing ones.
    expect(payload['name']).toBe('Business')
    expect(payload['currency']).toBe('EUR')
  })

  it('create forwards a chosen icon', () => {
    syncEntityCreate('userProfile', profile({ icon: '🎯' }))
    expect(handle.queueCreate).toHaveBeenCalledTimes(1)
    expect(handle.queueCreate.mock.calls[0][2]).toMatchObject({ icon: '🎯' })
  })

  /**
   * ⚠️ Unlike `sortOrder`, `icon` is OMITTED rather than sent as null when unset.
   * `updateEntity` does a partial `.set()`, so omitting the key leaves the server
   * value untouched — which is what we want for a profile that has never had an
   * icon chosen. Story 54.2 ships no "clear my icon" affordance, so there is no
   * case that needs to transmit an explicit null.
   */
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('omits the icon key entirely when it is %s', (_label, value) => {
    syncEntityUpdate('userProfile', profile({ icon: value }))
    const payload = handle.queueUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(Object.hasOwn(payload, 'icon')).toBe(false)
  })
})

/**
 * GATE 2 — `syncOperationDataSchema` (packages/core/src/sync/types.ts).
 *
 * The most dangerous of the four: this gate STRIPS undeclared keys.
 *
 * MUTATION KILLED (M2): delete `icon` from syncOperationDataSchema.
 */
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

  /**
   * Proves the assertion above is discriminating: this gate really does strip, so
   * "the key survived" is evidence the declaration exists, not a tautology.
   */
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

/**
 * GATE 3 — `userProfileSchema` in server/api/sync.ts (a hand-maintained duplicate
 * of core's).
 *
 * Validates, does not strip — see the header. Without the declaration an
 * over-long value would sail through to the INSERT and fail against
 * `varchar(16)` there instead of at the boundary.
 *
 * MUTATION KILLED (M7): delete `icon` from the server's userProfileSchema.
 */
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

  /**
   * ⚠️ NOT DISCRIMINATING ON ITS OWN, and measured as such: with `icon` removed
   * from the server schema (arm M7) this test still PASSES, because the gate does
   * not strip. It documents the retain-through behaviour the pull path relies on;
   * the assertion that actually pins the declaration is the rejection below.
   */
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
