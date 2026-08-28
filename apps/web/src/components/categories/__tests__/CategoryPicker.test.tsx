/**
 * CategoryPicker tests (story 30.4b AC-1/AC-3/AC-4/AC-5; story 41.2 AC-1/AC-4/AC-5/AC-6/AC-7/AC-8).
 *
 * The picker is the only premium-gated control that renders INSIDE another
 * modal, so its gate is asserted here in all three tier states — including the
 * one that matters most: what the locked state does when activated.
 *
 * ⚠️ Story 41.2 REVERSED story 30.4b's AC-5. The locked state used to be inert
 * content ("nothing to click, nothing to open") and is now a LINK to `/pricing`.
 * The assertions below pin the DESTINATION, because the old pins — `no button`
 * and `no second dialog` — are both satisfied by an `<a>` and would have stayed
 * green against the change they existed to forbid.
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

describe('CategoryPicker — gate (30.4b AC-4/AC-5; 41.2 AC-5/AC-7)', () => {
  it.each([
    ['free' as const, false],
    ['past_due' as const, true],
    ['canceled' as const, true],
    [null, false],
  ])(
    'renders a locked link to /pricing, not a picker, for %s',
    (subscriptionStatus, isAuthenticated) => {
      mockStatus({ hasAccess: false, subscriptionStatus, isAuthenticated })
      seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

      render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

      expect(screen.getByTestId('expense-category-locked')).toBeInTheDocument()
      expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
      // Discoverable, not hidden (FR24).
      expect(screen.getByText('Premium')).toBeInTheDocument()
      // 41.2 AC-5/AC-7: every non-entitled tier LEADS somewhere, and the
      // destination is asserted. `/pricing` is written out here rather than read
      // back from the component, so a change to the component's href fails this.
      expect(
        within(screen.getByTestId('expense-category-locked')).getByRole('link')
      ).toHaveAttribute('href', '/pricing')
    }
  )

  it('treats an ERRORED tier check as not premium, and still leads to /pricing (fail-closed)', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: null, error: 'check failed' })
    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    const locked = screen.getByTestId('expense-category-locked')
    expect(locked).toBeInTheDocument()
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
    // An errored check must present as locked AND as an invitation — never as
    // unlocked, and never as the inert dead end this story removed.
    expect(within(locked).getByRole('link')).toHaveAttribute('href', '/pricing')
  })

  it('never renders category content while the tier is unknown (41.2 AC-5: loading is UNCHANGED)', () => {
    mockStatus({ isLoading: true })
    seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    expect(screen.getByTestId('expense-category-skeleton')).toBeInTheDocument()
    // The seeded name must not leak for a frame before the tier resolves.
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
    // ⚠️ Story 41.2 deliberately did NOT extend the link to this state. The
    // epic's AC-5 names "loading" alongside errored/unauthenticated, but
    // rendering a lock here would reverse story 7-2 DECISION 3 and story 38.2:
    // a paying user would flash a lock before their tier resolves. The skeleton
    // is already fail-closed — it renders neither the <select> nor a category.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('expense-category-locked')).not.toBeInTheDocument()
  })

  it('41.2 AC-1/AC-3: the locked control is a LINK out of the form, not a button that opens a dialog', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    const locked = screen.getByTestId('expense-category-locked')
    const link = within(locked).getByRole('link')
    expect(link).toHaveAttribute('href', '/pricing')

    // Still NOT `PremiumFeatureGate`'s shape: that renders a <button> which
    // opens `PremiumPrompt asDialog` → a second <Modal>. This picker renders
    // inside the Add/Edit <Modal>, and `Modal` does not inert the background
    // (Modal.tsx:38-40), so a nested dialog stays forbidden.
    expect(within(locked).queryByRole('button')).not.toBeInTheDocument()
    // ⚠️ Deliberately NOT `user.click(link)`. jsdom does not implement
    // navigation, so clicking a real `<a href>` emits
    // `Error: Not implemented: navigation (except hash changes)` to stderr —
    // noise that a fail-on-console-error config would turn red. The click added
    // nothing anyway: with no `onClick` on the anchor, "no dialog opens" already
    // follows from the element being an `<a>` with an href. The NAVIGATION
    // itself is proved in `e2e/categories-premium.spec.ts`, which is the only
    // layer that can prove it.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('41.2 AC-4: says the form will close before the user commits to leaving', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    const link = within(screen.getByTestId('expense-category-locked')).getByRole('link')
    // The entry form's state is component-local, so leaving the route discards
    // it. That is the recorded decision — but it must not be a SILENT one, so
    // the consequence is legible before activation, in the accessible name too
    // (a bare `aria-label` would replace the subtree and hide it).
    expect(link).toHaveAccessibleName(/closes this form/i)
    expect(link).toHaveTextContent(/closes this form/i)
  })

  it('41.2 AC-8: the link restores a visible focus ring in a non-destructive colour', () => {
    mockStatus({ hasAccess: false, subscriptionStatus: 'free', isAuthenticated: true })

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    const link = within(screen.getByTestId('expense-category-locked')).getByRole('link')
    const tokens = link.className.split(/\s+/)
    // ⚠️ UNCONDITIONAL. This was once guarded by
    // `if (tokens.includes('focus:outline-none'))`, which made it self-cancelling:
    // dropping the outline token would have SKIPPED the ring check rather than
    // failing it, leaving only "not red" behind. Story 28-1 AC-7 wants a visible
    // ring on this control either way, so assert it outright.
    expect(tokens, 'locked link has no visible focus ring').toContain('focus:ring-2')
    expect(tokens, 'a ring with no colour is not visible').toContain('focus:ring-blue-500')
    // Story 11-3 AC-2 reserves red for destructive actions.
    expect(tokens).not.toContain('focus:ring-red-500')
  })

  it('41.2 AC-6: an entitled user gets the real <select> and no navigation affordance', () => {
    premium()
    seed([category({ id: 'e1', name: 'Groceries', kind: 'expense' })])

    render(<CategoryPicker kind="expense" value={null} onChange={vi.fn()} idPrefix="expense" />)

    expect(screen.getByTestId('expense-category-select')).toBeInTheDocument()
    expect(screen.getByLabelText('Category')).toBeInTheDocument()
    // No link, no lock badge, no trace of the locked branch.
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()
    expect(screen.queryByTestId('expense-category-locked')).not.toBeInTheDocument()
  })
})
