/**
 * Sync read-endpoint auth tests (Story 5.8 — AC group B / AC-7)
 *
 * The read server functions (syncGetHistory / syncGetAuditLogs / syncGetStatus)
 * must require an authenticated request and must key the underlying read on the
 * SESSION user id (`userResult.data.userId`) — never call the read helpers with
 * an undefined id, and never return a user's data for an unauthenticated call.
 *
 * The db layer is mocked by mocking the api/sync read helpers; auth is mocked by
 * mocking getUserContext. No database is loaded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/server/api/data/forecasting', () => ({
  getUserContext: vi.fn(),
}))

vi.mock('@/server/api/sync', () => ({
  PAID_SYNC_STATUSES: ['active', 'past_due'],
  processBatchSync: vi.fn(),
  getSyncHistory: vi.fn(),
  getSyncAuditLogs: vi.fn(),
  getSyncStatus: vi.fn(),
}))

import { getUserContext } from '@/server/api/data/forecasting'
import { getSyncAuditLogs, getSyncHistory, getSyncStatus } from '@/server/api/sync'
import { syncGetAuditLogs, syncGetHistory, syncGetStatus } from '../sync'

const SESSION_USER_ID = '550e8400-e29b-41d4-a716-446655440000'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

function mockAuthed() {
  asMock(getUserContext).mockResolvedValue({
    success: true,
    data: { userId: SESSION_USER_ID, isAuthenticated: true },
  })
}

function mockUnauthed() {
  asMock(getUserContext).mockResolvedValue({ success: false, data: null })
}

function mockAuthThrows() {
  asMock(getUserContext).mockRejectedValue(new Error('malformed request'))
}

const req = () => new Request('https://app.test/api/sync')

beforeEach(() => {
  vi.clearAllMocks()
  asMock(getSyncHistory).mockResolvedValue([])
  asMock(getSyncAuditLogs).mockResolvedValue([])
  asMock(getSyncStatus).mockResolvedValue({
    pendingCount: 0,
    conflictCount: 0,
    lastSyncTimestamp: null,
    status: 'PENDING',
  })
})

describe('syncGetHistory', () => {
  it('returns [] and never queries when unauthenticated', async () => {
    mockUnauthed()
    const result = await syncGetHistory(req())
    expect(result).toEqual([])
    expect(getSyncHistory).not.toHaveBeenCalled()
  })

  it('returns [] when auth throws', async () => {
    mockAuthThrows()
    const result = await syncGetHistory(req())
    expect(result).toEqual([])
    expect(getSyncHistory).not.toHaveBeenCalled()
  })

  it('queries with the SESSION userId (not undefined) when authenticated', async () => {
    mockAuthed()
    await syncGetHistory(req())
    expect(getSyncHistory).toHaveBeenCalledWith(SESSION_USER_ID)
  })
})

describe('syncGetAuditLogs', () => {
  it('returns [] when unauthenticated', async () => {
    mockUnauthed()
    expect(await syncGetAuditLogs(req())).toEqual([])
    expect(getSyncAuditLogs).not.toHaveBeenCalled()
  })

  it('queries with the SESSION userId when authenticated', async () => {
    mockAuthed()
    await syncGetAuditLogs(req())
    expect(getSyncAuditLogs).toHaveBeenCalledWith(SESSION_USER_ID)
  })
})

describe('syncGetStatus', () => {
  it('returns PENDING status and never queries when unauthenticated', async () => {
    mockUnauthed()
    const result = await syncGetStatus(req())
    expect(result.status).toBe('PENDING')
    expect(getSyncStatus).not.toHaveBeenCalled()
  })

  it('queries with the SESSION userId when authenticated', async () => {
    mockAuthed()
    await syncGetStatus(req())
    expect(getSyncStatus).toHaveBeenCalledWith(SESSION_USER_ID)
  })
})
