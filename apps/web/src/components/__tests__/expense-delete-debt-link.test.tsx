import { renderWithProviders, screen, userEvent, within } from '@/test/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSyncBridge, registerSyncBridge } from '../../lib/sync/syncBridge'
import { useBalanceStore } from '../../stores/balanceStore'
import { useExpenseStore } from '../../stores/expenseStore'
import { useProfileStore } from '../../stores/profileStore'
import { ExpensesPage } from '../ExpensesPage'

type BalanceEntry = ReturnType<typeof useBalanceStore.getState>['entries'][number]

const ISO = '2026-10-06T00:00:00.000Z'
const PROFILE_A = 'profile-a'
const PROFILE_B = 'profile-b'

const UNLINKED_RENT = 'Are you sure you want to delete "Rent"? This cannot be undone.'

function expense(id: string, name: string, profileId: string | null = null) {
  return {
    id,
    userId: 0,
    categoryId: null,
    name,
    amount: 45_000,
    frequency: 'monthly' as const,
    profileId,
    createdAt: ISO,
    updatedAt: ISO,
  }
}

function balance(
  id: string,
  type: BalanceEntry['type'],
  name: unknown,
  paymentExpenseId: string | null,
  profileId: string | null = null
): BalanceEntry {
  return {
    id,
    type,
    name: name as string,
    currentBalance: 1_200_000,
    monthlyContribution: 0,
    frequency: 'monthly',
    paymentExpenseId,
    profileId,
    createdAt: ISO,
    updatedAt: ISO,
  } as BalanceEntry
}

function seed(entries: BalanceEntry[]): void {
  useExpenseStore.setState({
    expenses: [expense('exp-car', 'Car payment'), expense('exp-rent', 'Rent')],
  })
  useBalanceStore.setState({ entries })
}

function resetStores(): void {
  useExpenseStore.setState({ expenses: [] })
  useBalanceStore.setState({ entries: [] })
}

async function openDelete(name: string) {
  const user = userEvent.setup()
  renderWithProviders(<ExpensesPage />)
  await user.click(screen.getByRole('button', { name: `Delete ${name}` }))
  return { user, dialog: screen.getByRole('alertdialog') }
}

describe('the expense delete dialog names the debt it pays (Story 113.1)', () => {
  let savedProfiles: ReturnType<typeof useProfileStore.getState>

  beforeEach(() => {
    savedProfiles = useProfileStore.getState()
    resetStores()
  })
  afterEach(() => {
    resetStores()
    useProfileStore.setState(savedProfiles)
  })

  it('(a) one linked debt: the D6 sentence sits between the question and "cannot be undone" (AC 1)', async () => {
    seed([balance('debt-1', 'debt', 'Car loan', 'exp-car')])
    const { dialog } = await openDelete('Car payment')
    expect(dialog).toHaveAccessibleDescription(
      'Are you sure you want to delete "Car payment"? It pays your debt "Car loan". Deleting it unlinks the debt, and your forecast will stop paying it down. This cannot be undone.'
    )
  })

  it('(b) an expense no debt links reads exactly as before (AC 3)', async () => {
    seed([balance('debt-1', 'debt', 'Car loan', 'exp-car')])
    const { dialog } = await openDelete('Rent')
    expect(dialog).toHaveAccessibleDescription(UNLINKED_RENT)
  })

  it('(b) a NON-debt row carrying the id is not a link: the dialog is unchanged (AC 3)', async () => {
    seed([
      balance('inv-1', 'investment', 'Pension', 'exp-rent'),
      balance('asset-1', 'asset', 'House', 'exp-rent'),
    ])
    const { dialog } = await openDelete('Rent')
    expect(dialog).toHaveAccessibleDescription(UNLINKED_RENT)
  })

  it('(c) two debts linking one expense: both named, in store order, plural (AC 2)', async () => {
    seed([
      balance('debt-b', 'debt', 'Student loan', 'exp-rent'),
      balance('debt-other', 'debt', 'Card', 'exp-car'),
      balance('debt-a', 'debt', 'Family loan', 'exp-rent'),
    ])
    const { dialog } = await openDelete('Rent')
    expect(dialog).toHaveAccessibleDescription(
      'Are you sure you want to delete "Rent"? It pays your debts "Student loan" and "Family loan". Deleting it unlinks them, and your forecast will stop paying them down. This cannot be undone.'
    )
  })

  it('(d) a debt in ANOTHER profile linking an unscoped expense is named too (AC 4)', async () => {
    useProfileStore.setState({
      profiles: [
        { id: PROFILE_A, userId: 'u1', name: 'Mine', isDefault: true, currency: 'NONE' },
        { id: PROFILE_B, userId: 'u1', name: 'Partner', isDefault: false, currency: 'NONE' },
      ],
      activeProfileId: PROFILE_A,
    })
    seed([balance('debt-b', 'debt', 'Partner car loan', 'exp-car', PROFILE_B)])
    const { dialog } = await openDelete('Car payment')
    expect(dialog).toHaveAccessibleDescription(
      'Are you sure you want to delete "Car payment"? It pays your debt "Partner car loan". Deleting it unlinks the debt, and your forecast will stop paying it down. This cannot be undone.'
    )
  })

  it.each([
    ['blank', '   '],
    ['non-string', 42],
    ['missing', undefined],
  ])('(e) a %s debt name: "one of your debts", no quotes (AC 6)', async (_kind, name) => {
    seed([balance('debt-1', 'debt', name, 'exp-car')])
    const { dialog } = await openDelete('Car payment')
    expect(dialog).toHaveAccessibleDescription(
      'Are you sure you want to delete "Car payment"? It pays one of your debts. Deleting it unlinks the debt, and your forecast will stop paying it down. This cannot be undone.'
    )
  })

  it('(e) a debt name is trimmed (AC 6)', async () => {
    seed([balance('debt-1', 'debt', '  Car loan  ', 'exp-car')])
    const { dialog } = await openDelete('Car payment')
    expect(dialog).toHaveAccessibleDescription(
      'Are you sure you want to delete "Car payment"? It pays your debt "Car loan". Deleting it unlinks the debt, and your forecast will stop paying it down. This cannot be undone.'
    )
  })

  it('(f) confirming deletes ONLY the expense; the debt keeps its link (AC 5, 102.1 D8)', async () => {
    seed([balance('debt-1', 'debt', 'Car loan', 'exp-car')])
    const { user, dialog } = await openDelete('Car payment')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(useExpenseStore.getState().expenses.map((row) => row.id)).toEqual(['exp-rent'])
    expect(useBalanceStore.getState().entries).toEqual([
      balance('debt-1', 'debt', 'Car loan', 'exp-car'),
    ])
  })

  it('(g) cancelling deletes nothing (AC 5)', async () => {
    seed([balance('debt-1', 'debt', 'Car loan', 'exp-car')])
    const { user, dialog } = await openDelete('Car payment')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(useExpenseStore.getState().expenses.map((row) => row.id)).toEqual([
      'exp-car',
      'exp-rent',
    ])
  })

  it('a PAID session enqueues exactly the one expense delete, no balance write (AC 5)', async () => {
    // Registered so these spies are reachable; otherwise not.toHaveBeenCalled() is a tautology.
    const spies = {
      userId: '550e8400-e29b-41d4-a716-446655440000',
      queueCreate: vi.fn(async () => {}),
      queueUpdate: vi.fn(async () => {}),
      queueDelete: vi.fn(async () => {}),
    }
    registerSyncBridge(spies)
    try {
      seed([balance('debt-1', 'debt', 'Car loan', 'exp-car')])
      const { user, dialog } = await openDelete('Car payment')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(spies.queueDelete).toHaveBeenCalledTimes(1)
      expect(spies.queueDelete.mock.calls[0]).toContain('exp-car')
      expect(spies.queueUpdate).not.toHaveBeenCalled()
      expect(spies.queueCreate).not.toHaveBeenCalled()
    } finally {
      clearSyncBridge()
    }
  })
})
