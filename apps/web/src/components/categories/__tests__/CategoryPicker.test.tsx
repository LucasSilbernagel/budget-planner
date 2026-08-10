/**
 * CategoryPicker tests (story 30.4b, AC-1/AC-3/AC-4/AC-5).
 *
 * The picker is the only premium-gated control that renders INSIDE another
 * modal, so its gate is asserted here in all three tier states — including the
 * one that matters most: that the locked state has nothing to open (AC-5).
 *
 * ⚠️ Asserting the picker RENDERED is not asserting it FILTERED. Every list
 * assertion below names both what must be present and what must be absent
 * (30.4a review lesson: coverage of a query's existence is not coverage of its
 * semantics).
 */

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PremiumAccessStatus } from '../../../hooks/usePremiumAccess'
import { type ClientCategory, useCategoryStore } from '../../../stores/categoryStore'

const usePremiumAccess = vi.fn()

vi.mock('../../../hooks/usePremiumAccess', () => ({
  usePremiumAccess: () => usePremiumAccess(),
}))

import { CategoryPicker } from '../CategoryPicker'

function mockStatus(overrides: Partial<PremiumAccessStatus>): void {
  usePremiumAccess.mockReturnValue({
    status: {
      hasAccess: false,
      subscriptionStatus: null,
      isLoading: false,
      error: null,
      isAuthenticated: false,
      ...overrides,
    } satisfies PremiumAccessStatus,
  })
}

const premium = () =>
  mockStatus({ hasAccess: true, subscriptionStatus: 'active', isAuthenticated: true })

function category(overrides: Partial<ClientCategory> & { id: string }): ClientCategory {
  return {
    userId: 0,
    profileId: null,
    name: 'Groceries',
    kind: 'expense',
    isDeleted: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function seed(categories: ClientCategory[]): void {
  useCategoryStore.setState({ categories })
}

beforeEach(() => {
  vi.clearAllMocks()
  seed([])
})

afterEach(() => {
  // This file's afterEach runs BEFORE testing-library's auto-cleanup, so the
  // picker is still mounted and subscribed when the store is reset.
  act(() => {
    seed([])
  })
})

describe('CategoryPicker — premium user (AC-1)', () => {
  it('offers the uncategorized option first, then this form’s categories', () => {
    premium()
    seed([
      category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
      category({ id: 'e2', name: 'Rent', kind: 'expense' }),
    ])

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    const select = screen.getByLabelText('Category')
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toEqual(['Uncategorized', 'Groceries', 'Rent'])
  })

  it('filters by KIND — an income category never appears on the expense form', () => {
    premium()
    seed([
      category({ id: 'i1', name: 'Salary', kind: 'income' }),
      category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
    ])

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    const select = screen.getByLabelText('Category')
    expect(within(select).getByRole('option', { name: 'Groceries' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'Salary' })).not.toBeInTheDocument()
  })

  it('filters by KIND in the other direction too — the income form omits expense categories', () => {
    premium()
    seed([
      category({ id: 'i1', name: 'Salary', kind: 'income' }),
      category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
    ])

    render(<CategoryPicker kind="income" value={null} onChange={vi.fn()} idPrefix="income" />)

    const select = screen.getByLabelText('Category')
    expect(within(select).getByRole('option', { name: 'Salary' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'Groceries' })).not.toBeInTheDocument()
  })

  it('omits soft-deleted categories from the pickable set', () => {
    premium()
    seed([
      category({ id: 'e1', name: 'Groceries', kind: 'expense' }),
      category({ id: 'e2', name: 'Gone', kind: 'expense', isDeleted: true }),
    ])

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    const select = screen.getByLabelText('Category')
    expect(within(select).getByRole('option', { name: 'Groceries' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: 'Gone' })).not.toBeInTheDocument()
  })

  it('reports a chosen category by id, and uncategorized as null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    premium()
    seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

    const { rerender } = render(
      <CategoryPicker kind="expense" value={null} onChange={onChange} idPrefix="expense" />
    )

    await user.selectOptions(screen.getByLabelText('Category'), 'e1')
    expect(onChange).toHaveBeenCalledWith('e1')

    rerender(<CategoryPicker kind="expense" value="e1" onChange={onChange} idPrefix="expense" />)
    // The empty-string sentinel must arrive at the caller as `null`, never as ''.
    await user.selectOptions(screen.getByLabelText('Category'), '')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('is NOT required — leaving a row uncategorized is always valid (AC-1)', () => {
    premium()
    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)
    // Every other select on these two pages carries `required`; this one must not.
    expect(screen.getByLabelText('Category')).not.toBeRequired()
  })

  it('displays a dangling categoryId as uncategorized rather than a blank selection (AC-3)', () => {
    // ⚠️ HONEST LIMIT, recorded in the mutation ledger as M12. This assertion
    // does NOT discriminate: deleting the `selectedValue` normalization in
    // `CategoryPicker` leaves this test GREEN, because jsdom reports
    // `selectedIndex === 0` (and `value === ''`) for a <select> whose value
    // matches no option, where the HTML spec and real browsers use -1 and paint
    // a BLANK control. The guard defends the real-browser behaviour AC-3 calls
    // for ("never blank"), and neither harness can see it: the e2e suite is
    // unauthenticated, so it only ever reaches the LOCKED picker. What this test
    // does prove is that the dangling id is not offered and does not crash.
    premium()
    seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

    render(
      <CategoryPicker
        kind="expense"
        value="not-on-this-device"
        onChange={vi.fn()}
        idPrefix="expense"
      />
    )

    const select = screen.getByLabelText('Category') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(
      within(select).queryByRole('option', { name: 'not-on-this-device' })
    ).not.toBeInTheDocument()
  })

  it('kills the native outline only alongside a real 2px coloured ring', () => {
    // Mirrors the guard on the name/amount/frequency controls (IncomePage.test),
    // with the same counter so a reshaped class string cannot silently assert
    // nothing. The picker is not in THAT test's array because it renders locked
    // for its unauthenticated fixture.
    premium()
    const control = (() => {
      render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)
      return screen.getByLabelText('Category')
    })()

    const tokens = control.className.split(/\s+/)
    let checked = 0
    expect(tokens, 'category picker no longer kills the native outline').toContain(
      'focus:outline-none'
    )
    checked++
    expect(tokens, 'category picker has no visible focus ring').toContain('focus:ring-2')
    checked++
    expect(
      tokens.some((t) => /^focus:ring-(?!offset-|inset$)[a-z]+-\d+$/.test(t)),
      'category picker has a ring width but no ring colour'
    ).toBe(true)
    checked++
    expect(checked).toBe(3)
  })
})

describe('CategoryPicker — gate (AC-4, AC-5)', () => {
  it.each([
    ['free' as const, false],
    ['past_due' as const, true],
    ['canceled' as const, true],
    [null, false],
  ])('renders locked, not a picker, for %s', (subscriptionStatus, isAuthenticated) => {
    mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated })
    seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    expect(screen.getByTestId('expense-category-locked')).toBeInTheDocument()
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
    // Discoverable, not hidden (FR24).
    expect(screen.getByText('Premium')).toBeInTheDocument()
  })

  it('treats an ERRORED tier check as not premium (fail-closed)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    expect(screen.getByTestId('expense-category-locked')).toBeInTheDocument()
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
  })

  it('never renders category content while the tier is unknown', () => {
    mockStatus({ isLoading: true })
    seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    expect(screen.getByTestId('expense-category-skeleton')).toBeInTheDocument()
    // The seeded name must not leak for a frame before the tier resolves.
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
  })

  it('AC-5: the locked affordance is INERT — no button, so nothing can open a nested modal', async () => {
    const user = userEvent.setup()
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    const locked = screen.getByTestId('expense-category-locked')
    // `PremiumFeatureGate`'s locked branch is a <button> that opens
    // `PremiumPrompt asDialog` → a <Modal>. This picker must not be that.
    expect(within(locked).queryByRole('button')).not.toBeInTheDocument()

    await user.click(locked)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
