/**
 * CategoryManager tests (story 30.4b, AC-2, AC-6).
 *
 * Create / rename / delete against the REAL store and the real
 * `useCategoryManager` — the point of this surface is the cross-store cascade
 * and the store's own validation, so mocking either would test the mock.
 *
 * ⚠️ Asserting the confirm dialog OPENED is not asserting it showed the right
 * COUNT, and asserting an error rendered is not asserting the reason MATCHED.
 * Every assertion below names the specific value (30.4a review lesson).
 */

import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_CATEGORY_NAME_LENGTH, useCategoryStore } from '../../../stores/categoryStore'
import { useExpenseStore } from '../../../stores/expenseStore'
import { useIncomeStore } from '../../../stores/incomeStore'
import { CategoryManager } from '../CategoryManager'

function resetStores(): void {
  useCategoryStore.setState({ categories: [] })
  useIncomeStore.setState({ incomeSources: [] })
  useExpenseStore.setState({ expenses: [] })
}

beforeEach(resetStores)
afterEach(() => {
  act(resetStores)
})

/** Create a category through the UI, the way a user does. */
async function addCategory(
  user: ReturnType<typeof userEvent.setup>,
  kind: 'income' | 'expense',
  name: string
): Promise<void> {
  await user.type(screen.getByTestId(`category-new-input-${kind}`), name)
  await user.click(screen.getByTestId(`category-add-${kind}`))
}

describe('creating a category (AC-2)', () => {
  it('creates it under the right kind and clears the input', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)

    await addCategory(user, 'expense', 'Groceries')

    const created = useCategoryStore.getState().categories
    expect(created).toHaveLength(1)
    expect(created[0]?.name).toBe('Groceries')
    expect(created[0]?.kind).toBe('expense')
    // It lands in the EXPENSE section, not merely somewhere on the page.
    const expenses = screen.getByTestId('category-section-expense')
    expect(within(expenses).getByText('Groceries')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('category-section-income')).queryByText('Groceries')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('category-new-input-expense')).toHaveValue('')
  })

  it('trims the stored name', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)

    await addCategory(user, 'expense', '  Groceries  ')

    expect(useCategoryStore.getState().categories[0]?.name).toBe('Groceries')
  })

  it('rejects an EMPTY name with the empty reason and creates nothing', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)

    await user.type(screen.getByTestId('category-new-input-expense'), '   ')
    await user.click(screen.getByTestId('category-add-expense'))

    expect(screen.getByTestId('category-error-empty')).toHaveTextContent(
      'Please enter a category name'
    )
    expect(useCategoryStore.getState().categories).toHaveLength(0)
  })

  it('rejects an OVER-LONG name with the too-long reason', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)

    // Reachable only because the input carries no `maxLength` — see the comment
    // on that input. `paste` rather than `type` keeps the test fast.
    await user.click(screen.getByTestId('category-new-input-expense'))
    await user.paste('x'.repeat(MAX_CATEGORY_NAME_LENGTH + 1))
    await user.click(screen.getByTestId('category-add-expense'))

    expect(screen.getByTestId('category-error-too-long')).toHaveTextContent(
      `cannot be longer than ${MAX_CATEGORY_NAME_LENGTH} characters`
    )
    expect(useCategoryStore.getState().categories).toHaveLength(0)
  })

  it('accepts a name of exactly the maximum length', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)

    await user.click(screen.getByTestId('category-new-input-expense'))
    await user.paste('x'.repeat(MAX_CATEGORY_NAME_LENGTH))
    await user.click(screen.getByTestId('category-add-expense'))

    expect(useCategoryStore.getState().categories).toHaveLength(1)
    expect(screen.queryByTestId('category-error-too-long')).not.toBeInTheDocument()
  })

  it('rejects a DUPLICATE case-insensitively and after trimming (AC-2, settled semantics)', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)

    await addCategory(user, 'expense', 'Groceries')
    await addCategory(user, 'expense', '  groceries ')

    expect(screen.getByTestId('category-error-duplicate')).toHaveTextContent(
      'A category with this name already exists'
    )
    expect(useCategoryStore.getState().categories).toHaveLength(1)
  })

  it('allows the SAME name on the other kind — duplicates are scoped to the kind', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)

    await addCategory(user, 'expense', 'Travel')
    await addCategory(user, 'income', 'Travel')

    expect(useCategoryStore.getState().categories).toHaveLength(2)
    expect(screen.queryByTestId('category-error-duplicate')).not.toBeInTheDocument()
  })
})

describe('renaming a category (AC-2)', () => {
  it('renames it, and every referencing row shows the new name with no per-row edit', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')
    const id = useCategoryStore.getState().categories[0]?.id as string
    act(() => {
      useExpenseStore.setState({
        expenses: [
          {
            id: 'row-1',
            userId: 0,
            name: 'Tesco run',
            amount: 8000,
            frequency: 'monthly',
            categoryId: id,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    })

    await user.click(screen.getByRole('button', { name: 'Rename Groceries' }))
    await user.clear(screen.getByTestId('category-rename-input-expense'))
    await user.type(screen.getByTestId('category-rename-input-expense'), 'Food')
    await user.click(screen.getByTestId('category-rename-save-expense'))

    expect(useCategoryStore.getState().categories[0]?.name).toBe('Food')
    // The row still points at the SAME id — a rename is not a re-assignment.
    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBe(id)
    expect(screen.getByText('Food')).toBeInTheDocument()
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
  })

  it('rejects renaming onto an existing name and keeps the original', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')
    await addCategory(user, 'expense', 'Rent')

    await user.click(screen.getByRole('button', { name: 'Rename Rent' }))
    await user.clear(screen.getByTestId('category-rename-input-expense'))
    await user.type(screen.getByTestId('category-rename-input-expense'), 'GROCERIES')
    await user.click(screen.getByTestId('category-rename-save-expense'))

    expect(screen.getByTestId('category-error-duplicate')).toBeInTheDocument()
    expect(useCategoryStore.getState().categories.map((category) => category.name)).toEqual([
      'Groceries',
      'Rent',
    ])
  })

  it('renaming a category to its own name (different case) is allowed, not a self-duplicate', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')

    await user.click(screen.getByRole('button', { name: 'Rename Groceries' }))
    await user.clear(screen.getByTestId('category-rename-input-expense'))
    await user.type(screen.getByTestId('category-rename-input-expense'), 'GROCERIES')
    await user.click(screen.getByTestId('category-rename-save-expense'))

    expect(useCategoryStore.getState().categories[0]?.name).toBe('GROCERIES')
    expect(screen.queryByTestId('category-error-duplicate')).not.toBeInTheDocument()
  })

  it('reports NOT-FOUND (not "empty") when the category vanished mid-edit, and leaves edit mode', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')
    const id = useCategoryStore.getState().categories[0]?.id as string

    await user.click(screen.getByRole('button', { name: 'Rename Groceries' }))
    await user.clear(screen.getByTestId('category-rename-input-expense'))
    await user.type(screen.getByTestId('category-rename-input-expense'), 'Food')

    // Deleted on another device / in another tab while this form was open.
    act(() => {
      useCategoryStore.getState().deleteCategory(id)
    })
    await user.click(screen.getByTestId('category-rename-save-expense'))

    // The reason must be `not-found`, NOT `empty` — a two-valued union forced
    // the wrong one and sent focus to a name input that was never the problem.
    expect(screen.getByTestId('category-error-not-found')).toHaveTextContent('Category not found')
    expect(screen.queryByTestId('category-error-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('category-rename-input-expense')).not.toBeInTheDocument()
  })
})

describe('focus after the delete confirmation closes (code review 30.4b)', () => {
  // ⚠️ `ConfirmDialog` forwards `finalFocusRef` to `Modal`, which calls
  // `.focus()` on it unconditionally when the dialog closes. The ref points at
  // the manager's <main>, and an element with no `tabIndex` is NOT focusable —
  // so `.focus()` was a silent no-op and focus fell to <body>, making a keyboard
  // user restart tabbing from the top of the page after every delete OR cancel.
  it.each([
    ['cancelling', 'delete-confirm-cancel'],
    ['confirming', 'delete-confirm-confirm'],
  ])('%s returns focus to the list, not <body>', async (_label, testId) => {
    const user = userEvent.setup()
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')

    await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))
    await user.click(screen.getByTestId(testId))

    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.tagName).toBe('MAIN')
  })
})

describe('single-root invariant (story 30.5)', () => {
  /**
   * ⚠️ THE MANAGER MUST RENDER EXACTLY ONE ROOT ELEMENT.
   *
   * Story 30.5 hoisted the page shell into `CategoriesPage`, which now stacks
   * `<CategoryManager />` and `<CategoryBreakdown />` in a `space-y-8`
   * container. `Modal` renders IN NORMAL FLOW with no portal, and the
   * `ConfirmDialog` is a SIBLING of <header>/<main> inside this component — so
   * if the manager ever returned a fragment instead of a wrapper, `> * + *`
   * would apply a top margin to the FIXED overlay and leave an undimmed strip
   * across the top of the open dialog.
   *
   * That failure is invisible to every other assertion in this file (they all
   * pass with the dialog present but mis-offset), so it is pinned here.
   */
  it('renders one root element, so a spaced parent cannot margin the fixed overlay', () => {
    const { container } = render(<CategoryManager />)
    expect(container.children).toHaveLength(1)
  })

  it('keeps the ConfirmDialog INSIDE that root while open', async () => {
    const user = userEvent.setup()
    const { container } = render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    // Still one root: the dialog is nested, not a spaced sibling of the manager.
    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild?.contains(screen.getByRole('alertdialog'))).toBe(true)
  })
})

describe('per-row accessible names (code review 30.4b)', () => {
  it('binds each Rename/Delete button to the category it acts on', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')
    await addCategory(user, 'expense', 'Rent')

    // ⚠️ Before the review fix these buttons were all named just "Rename" /
    // "Delete", so a screen-reader user could not tell which category a
    // DESTRUCTIVE action targeted. The old tests passed only BECAUSE the names
    // were not distinguishing — `getByRole` would have thrown on ambiguity had
    // they been correct.
    expect(screen.getByRole('button', { name: 'Delete Groceries' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Rent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename Groceries' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rename Rent' })).toBeInTheDocument()
    // And the bare name must no longer match anything, in either direction.
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
  })
})

describe('deleting a category (AC-2)', () => {
  async function setupWithRows(user: ReturnType<typeof userEvent.setup>): Promise<string> {
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')
    const id = useCategoryStore.getState().categories[0]?.id as string
    act(() => {
      useExpenseStore.setState({
        expenses: [1, 2].map((n) => ({
          id: `expense-${n}`,
          userId: 0,
          name: `Shop ${n}`,
          amount: 1000,
          frequency: 'monthly' as const,
          categoryId: id,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        })),
      })
      useIncomeStore.setState({
        incomeSources: [
          {
            id: 'income-1',
            userId: 0,
            name: 'Refunds',
            amount: 500,
            frequency: 'monthly' as const,
            // A DIFFERENT category's row must not be counted.
            categoryId: 'someone-else',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    })
    return id
  }

  it('states the number of AFFECTED rows — not the total number of rows', async () => {
    const user = userEvent.setup()
    await setupWithRows(user)

    await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('2 entries will be left uncategorized')
    // Three rows exist in total; only two use this category.
    expect(dialog).not.toHaveTextContent('3 entries')
  })

  it('the count is REACTIVE — it follows a row changing while the dialog is open', async () => {
    const user = userEvent.setup()
    const id = await setupWithRows(user)
    await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('2 entries')

    // A pull, another tab, or an edit behind the modal. A `countRowsUsing`
    // snapshot would still say 2 here and the user would confirm against a lie.
    act(() => {
      useExpenseStore.getState().updateExpense('expense-2', { categoryId: null })
    })

    expect(screen.getByRole('alertdialog')).toHaveTextContent('1 entry will be left uncategorized')
    expect(id).toBeTruthy()
  })

  it('says so plainly when nothing uses the category', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')

    await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent('No entries currently use it')
  })

  it('confirming soft-deletes it and leaves the affected rows uncategorized', async () => {
    const user = userEvent.setup()
    const id = await setupWithRows(user)

    await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))
    await user.click(screen.getByTestId('delete-confirm-confirm'))

    const category = useCategoryStore.getState().categories.find((c) => c.id === id)
    expect(category?.isDeleted).toBe(true)
    expect(useExpenseStore.getState().expenses.every((row) => row.categoryId === null)).toBe(true)
    // The unrelated income row keeps its own reference.
    expect(useIncomeStore.getState().incomeSources[0]?.categoryId).toBe('someone-else')
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument()
  })

  it('cancelling deletes nothing', async () => {
    const user = userEvent.setup()
    const id = await setupWithRows(user)

    await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))
    await user.click(screen.getByTestId('delete-confirm-cancel'))

    expect(useCategoryStore.getState().categories.find((c) => c.id === id)?.isDeleted).toBe(false)
    expect(useExpenseStore.getState().expenses[0]?.categoryId).toBe(id)
    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  it('uses a themed alertdialog, never window.confirm', async () => {
    const user = userEvent.setup()
    render(<CategoryManager />)
    await addCategory(user, 'expense', 'Groceries')

    await user.click(screen.getByRole('button', { name: 'Delete Groceries' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
