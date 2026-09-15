/**
 * IncomePage vs. the initial-sync-pending window (Story 53.1, AC-4; redesigned
 * in code review).
 *
 * Before Story 53.1, ActiveSync's mount-time pull never actually ran for
 * anyone (see SyncProvider.hasProbableSession), so a fresh device's "no local
 * rows yet" state was indistinguishable from... nothing running at all — this
 * window did not exist. Now that a paid session's first pull genuinely fires,
 * this file proves a fresh device shows a loading state (not a confident "no
 * income sources yet") while that pull is in flight, resolves to the real
 * empty message once it completes with nothing, and — critically for AC-6 —
 * a device that has synced at least once before (a persisted, device-level
 * flag, not a per-page check) is COMPLETELY unaffected even with zero local
 * rows and no pull resolved yet this session.
 */

import { renderWithProviders, screen } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIncomeStore } from '../../stores/incomeStore'

const STORAGE_KEY = 'sync:hasCompletedInitialPull'

const sessionStatus = vi.hoisted(() => ({
  resolved: true,
  isPaidSyncSession: true,
}))
const lastPullTimestamp = vi.hoisted(() => ({ value: null as number | null }))

vi.mock('../../lib/sync/sessionStatusStore', () => ({
  useSyncSessionStatus: () => ({
    resolved: sessionStatus.resolved,
    isPaidSyncSession: sessionStatus.isPaidSyncSession,
  }),
  useLastPullTimestamp: () => lastPullTimestamp.value,
}))

import { IncomePage } from '../IncomePage'

beforeEach(() => {
  sessionStatus.resolved = true
  sessionStatus.isPaidSyncSession = true
  lastPullTimestamp.value = null
  useIncomeStore.setState({ incomeSources: [] })
  window.localStorage.clear()
})

afterEach(() => {
  useIncomeStore.setState({ incomeSources: [] })
  window.localStorage.clear()
})

describe('IncomePage — initial sync pending (Story 53.1, AC-4)', () => {
  it('a fresh paid device (never synced, pull not yet complete) shows a loading state, not "No income sources yet"', () => {
    renderWithProviders(<IncomePage />)

    expect(screen.getByTestId('page-loading-status')).toBeInTheDocument()
    expect(screen.queryByText('No income sources yet')).not.toBeInTheDocument()
  })

  it('once the pull completes with nothing, the real empty state appears', () => {
    lastPullTimestamp.value = 1_700_000_000_000
    renderWithProviders(<IncomePage />)

    expect(screen.getByText('No income sources yet')).toBeInTheDocument()
  })

  it('AC-6: a device that has synced before is unaffected, even with zero local rows and no pull resolved this session', () => {
    window.localStorage.setItem(STORAGE_KEY, '1')
    // Local store is still empty and no pull has resolved THIS session — the
    // only signal distinguishing this from a genuinely fresh device is the
    // persisted device-level flag.
    renderWithProviders(<IncomePage />)

    expect(screen.getByText('No income sources yet')).toBeInTheDocument()
    expect(screen.queryByTestId('page-loading-status')).not.toBeInTheDocument()
  })

  it('AC-6: an established device that already has local rows is unaffected by the pull still being in flight', () => {
    useIncomeStore.getState().addIncomeSource({
      name: 'Salary',
      amount: 500000,
      frequency: 'monthly',
    })
    // Pull still pending (lastPullTimestamp stays null), device-flag also
    // unset — proves the data itself, once present, is never hidden.
    renderWithProviders(<IncomePage />)

    expect(screen.getByText('Salary')).toBeInTheDocument()
    expect(screen.queryByText('No income sources yet')).not.toBeInTheDocument()
  })

  it('a free (non-paid) session is unaffected regardless of pull state', () => {
    sessionStatus.isPaidSyncSession = false
    renderWithProviders(<IncomePage />)

    expect(screen.getByText('No income sources yet')).toBeInTheDocument()
  })
})
