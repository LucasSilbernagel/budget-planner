/**
 * useSync — server → client PULL wiring tests (Story 4-18).
 *
 * Exercises the hook the way the app uses it: manual pull() applies pulled
 * changes into the Zustand domain stores, auto-poll fires on the interval, and a
 * failing transport does not crash. The HTTP client (`fetchServerChanges`) and
 * the server push fn are mocked — no real network (NFR8).
 *
 * NOTE: pull() updates an external (zustand) store and triggers a re-render; we
 * deliberately do NOT wrap it in `act()` (which deadlocks against the hook's
 * still-settling init effect under React 19) and instead await the returned
 * promise and assert via the store / `waitFor`.
 */

import type { ServerChange } from '@budget-planner/core/sync'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the HTTP transport the hook wires into the core service.
vi.mock('../../features/api/client', () => ({
  fetchServerChanges: vi.fn(),
}))

// Avoid loading the real server push fn (it transitively imports db/zod).
vi.mock('../../server/functions/sync', () => ({
  processSyncOperation: vi.fn(),
}))

import { fetchServerChanges } from '../../features/api/client'
import { useIncomeStore } from '../../stores/incomeStore'
import { resetSyncStore, useSync } from '../useSync'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

// Story 5-14: entity ids are client-generatable uuids shared across devices, so a
// pulled change reconciles by the uuid string directly (no numeric coercion).
const INCOME_ID = '11111111-1111-4111-8111-111111111111'
const INCOME_ID_2 = '22222222-2222-4222-8222-222222222222'

function incomeChange(overrides: Partial<ServerChange> = {}): ServerChange {
  return {
    entityType: 'incomeSource',
    entityId: INCOME_ID,
    data: {
      id: INCOME_ID,
      name: 'Pulled Salary',
      amount: 123400,
      frequency: 'monthly',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    },
    updatedAt: 1000,
    isDeleted: false,
    ...overrides,
  }
}

describe('useSync pull wiring (Story 4-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSyncStore()
    useIncomeStore.setState({ incomeSources: [] })
    localStorage.clear()
    asMock(fetchServerChanges).mockResolvedValue([])
  })

  it('manual pull() applies a pulled create into the income store', async () => {
    asMock(fetchServerChanges).mockResolvedValue([incomeChange()])

    const { result, unmount } = renderHook(() =>
      useSync({ userId: 'u-1', autoSync: false, autoPull: false })
    )

    const pullResult = await result.current.pull()

    expect(fetchServerChanges).toHaveBeenCalled()
    expect(pullResult?.changesPulledCount).toBe(1)
    const sources = useIncomeStore.getState().incomeSources
    expect(sources.some((s) => s.id === INCOME_ID && s.name === 'Pulled Salary')).toBe(true)
    unmount()
  })

  it('a pulled tombstone removes the entity locally', async () => {
    useIncomeStore.setState({
      incomeSources: [
        {
          id: INCOME_ID,
          userId: 0,
          name: 'Existing',
          amount: 500,
          frequency: 'monthly',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    })
    asMock(fetchServerChanges).mockResolvedValue([
      incomeChange({ isDeleted: true, updatedAt: 2000 }),
    ])

    const { result, unmount } = renderHook(() =>
      useSync({ userId: 'u-1', autoSync: false, autoPull: false })
    )

    await result.current.pull()

    expect(useIncomeStore.getState().incomeSources.some((s) => s.id === INCOME_ID)).toBe(false)
    unmount()
  })

  it('auto-poll fires a pull on the interval (AC-4)', async () => {
    const { unmount } = renderHook(() =>
      useSync({ userId: 'u-1', autoSync: false, autoPull: true, pullInterval: 20 })
    )

    await waitFor(() => {
      expect(fetchServerChanges).toHaveBeenCalled()
    })
    unmount()
  })

  it('does not crash when the pull transport fails', async () => {
    asMock(fetchServerChanges).mockRejectedValue(new Error('network down'))

    const { result, unmount } = renderHook(() =>
      useSync({ userId: 'u-1', autoSync: false, autoPull: false })
    )

    const pullResult = await result.current.pull()

    // A transport failure surfaces as a structured failure result (AC-5: pull
    // "surfaces success/failure"), NOT a throw — the core catches the rejection
    // and returns { success: false, error }. The store stays intact and nothing
    // crashes.
    expect(pullResult?.success).toBe(false)
    expect(pullResult?.error).toContain('network down')
    expect(useIncomeStore.getState().incomeSources).toEqual([])
    unmount()
  })

  it('exposes forcePull as a callable manual trigger (AC-5)', async () => {
    asMock(fetchServerChanges).mockResolvedValue([
      incomeChange({ entityId: INCOME_ID_2, updatedAt: 1500 }),
    ])

    const { result, unmount } = renderHook(() =>
      useSync({ userId: 'u-1', autoSync: false, autoPull: false })
    )

    await result.current.forcePull()

    expect(useIncomeStore.getState().incomeSources.some((s) => s.id === INCOME_ID_2)).toBe(true)
    unmount()
  })
})
