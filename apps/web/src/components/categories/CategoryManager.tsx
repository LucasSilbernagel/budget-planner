/**
 * Category management UI — create, rename, delete (story 30.4b, AC-2).
 *
 * One section per `kind`, because a category belongs to exactly one side of the
 * ledger and the store's duplicate check is scoped to `(profile, kind)`: showing
 * both kinds in one list would make "that name is already taken" look wrong
 * whenever the clash was on the other side.
 *
 * ⚠️ No nested dialogs. The delete confirmation is the ONLY `Modal` this surface
 * ever opens, and renaming happens inline in the row rather than in a second
 * dialog — `Modal.tsx:27-30` assumes a single modal is open at a time.
 *
 * ⚠️ Local-first (AC-6). Every operation here is a synchronous `localStorage`
 * write; the sync bridge is fire-and-forget and a no-op without a sync handle,
 * so nothing on this page blocks on the network.
 *
 * Layout follows `profile-list.tsx`'s structure but NOT its styling — that file
 * hard-codes light-only classes (`bg-white`, `text-gray-900`) and would be
 * unreadable in dark mode. Surfaces here use the `surface`/`text-*` tokens.
 */

import type { CategoryKind } from '@budget-planner/db'
import { type ReactElement, useRef, useState } from 'react'
import { useCategoriesForActiveProfile } from '../../hooks/useCategoryLabels'
import {
  type CategoryValidationError,
  useCategoryManager,
  useCategoryRowCount,
} from '../../hooks/useCategoryManager'
import type { ClientCategory } from '../../stores/categoryStore'
import { ConfirmDialog } from '../ui/ConfirmDialog'

const SECTIONS: { kind: CategoryKind; title: string; description: string; placeholder: string }[] =
  [
    {
      kind: 'income',
      title: 'Income categories',
      description: 'Group income sources — for example Employment, Freelance, Dividends.',
      placeholder: 'e.g. Employment',
    },
    {
      kind: 'expense',
      title: 'Expense categories',
      description: 'Group expenses — for example Groceries, Housing, Transport.',
      placeholder: 'e.g. Groceries',
    },
  ]

/**
 * Whether an error is about what the user typed.
 *
 * ⚠️ This is exactly why `CategoryValidationError.reason` is four-valued rather
 * than two (code review 30.4a). `not-found` means the category was deleted —
 * on another device, or in another tab — while this row was being edited. It has
 * nothing to do with the name, so pulling focus back to the name input would ask
 * the user to fix something that is not broken.
 */
function isNameError(error: CategoryValidationError): boolean {
  return error.reason === 'empty' || error.reason === 'too-long' || error.reason === 'duplicate'
}

function ErrorMessage({ error, id }: { error: CategoryValidationError; id: string }): ReactElement {
  return (
    <p
      id={id}
      role="alert"
      className="mt-1 text-sm text-red-600 dark:text-red-400"
      data-testid={`category-error-${error.reason}`}
    >
      {error.message}
    </p>
  )
}

export function CategoryManager(): ReactElement {
  // Profile-scoped (code review 30.4b) — see `useCategoriesForActiveProfile`.
  const categories = useCategoriesForActiveProfile()
  const { createCategory, renameCategory, deleteCategory } = useCategoryManager()

  const [pendingDelete, setPendingDelete] = useState<ClientCategory | null>(null)
  // ⚠️ REACTIVE, not `countRowsUsing`. A snapshot read at render time freezes,
  // and confirming a destructive action against a stale number is precisely the
  // failure this count exists to prevent (code review 30.4a).
  const affectedRowCount = useCategoryRowCount(pendingDelete?.id)
  const listRef = useRef<HTMLElement>(null)

  const confirmDelete = (): void => {
    if (pendingDelete) {
      deleteCategory(pendingDelete.id)
      setPendingDelete(null)
    }
  }

  return (
    // ⚠️⚠️ THIS MUST STAY EXACTLY ONE ELEMENT (story 30.5). The page shell —
    // `min-h-screen surface-sunken p-4 sm:p-8` + `mx-auto max-w-3xl` — moved up
    // into `CategoriesPage` so the manager and the breakdown share one scroll
    // container instead of the breakdown starting a full viewport below the
    // fold. What is left is a bare wrapper with a load-bearing job: `Modal`
    // renders IN NORMAL FLOW with no portal, and the `ConfirmDialog` below is a
    // SIBLING of <header>/<main>. Returning a fragment of three children into
    // the page's `space-y-*` stack would apply a top margin to the FIXED
    // overlay and leave an undimmed strip across the top of the open dialog —
    // the same failure `HomePage.tsx` and `settings/categories-section.tsx`
    // both already carry a wrapper to prevent.
    <div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-heading">Categories</h1>
        <p className="mt-2 text-body">
          Create your own categories, then assign them to income sources and expenses. Renaming a
          category updates every entry that uses it.
        </p>
      </header>

      {/* `tabIndex={-1}` is load-bearing (code review 30.4b): this is the
            ConfirmDialog's `finalFocusRef`, and `Modal` calls `.focus()` on it
            unconditionally on close. A non-focusable element makes that a silent
            no-op and focus drops to <body>, so a keyboard user restarts tabbing
            from the top of the page after every delete OR cancel. */}
      <main className="space-y-6" ref={listRef} tabIndex={-1}>
        {SECTIONS.map((section) => (
          <CategorySection
            key={section.kind}
            kind={section.kind}
            title={section.title}
            description={section.description}
            placeholder={section.placeholder}
            categories={categories.filter((category) => category.kind === section.kind)}
            onCreate={createCategory}
            onRename={renameCategory}
            onRequestDelete={setPendingDelete}
          />
        ))}
      </main>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        finalFocusRef={listRef}
        confirmLabel="Delete category"
        message={
          <>
            Delete "{pendingDelete?.name}"?{' '}
            {affectedRowCount === 0
              ? 'No entries currently use it.'
              : `${affectedRowCount} ${
                  affectedRowCount === 1 ? 'entry' : 'entries'
                } will be left uncategorized.`}{' '}
            This cannot be undone.
          </>
        }
      />
    </div>
  )
}

interface CategorySectionProps {
  kind: CategoryKind
  title: string
  description: string
  placeholder: string
  categories: ClientCategory[]
  onCreate: ReturnType<typeof useCategoryManager>['createCategory']
  onRename: ReturnType<typeof useCategoryManager>['renameCategory']
  onRequestDelete: (category: ClientCategory) => void
}

function CategorySection({
  kind,
  title,
  description,
  placeholder,
  categories,
  onCreate,
  onRename,
  onRequestDelete,
}: CategorySectionProps): ReactElement {
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<CategoryValidationError | null>(null)
  /**
   * The row being renamed, held as a SNAPSHOT rather than an id.
   *
   * ⚠️ Load-bearing. `useLiveCategories` drops a category the moment it is
   * tombstoned, so a list rendered straight from it would unmount the open
   * rename form mid-keystroke if the category were deleted elsewhere — the
   * user's form would simply vanish with no explanation, and the `not-found`
   * reason the store returns could never be shown to anyone. Keeping the
   * snapshot lets the row stay put until the user submits and gets told why.
   */
  const [editing, setEditing] = useState<ClientCategory | null>(null)
  const [editingName, setEditingName] = useState('')
  const [renameError, setRenameError] = useState<CategoryValidationError | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)
  const editingNameRef = useRef<HTMLInputElement>(null)

  // Keep the row under edit visible even after it leaves the live set.
  const visibleCategories =
    editing && !categories.some((category) => category.id === editing.id)
      ? [...categories, editing]
      : categories

  const headingId = `categories-${kind}-heading`
  const createErrorId = `categories-${kind}-create-error`
  const renameErrorId = `categories-${kind}-rename-error`

  const handleCreate = (event: React.FormEvent): void => {
    event.preventDefault()
    // ⚠️ `createCategory` returns a result; it never throws, and the underlying
    // `addCategory` can return null. Both are handled by branching on `ok`
    // rather than assuming a row appeared.
    const result = onCreate(newName, kind)
    if (!result.ok) {
      setCreateError(result.error)
      newNameRef.current?.focus()
      return
    }
    setCreateError(null)
    setNewName('')
  }

  const startEditing = (category: ClientCategory): void => {
    setEditing(category)
    setEditingName(category.name)
    setRenameError(null)
  }

  const cancelEditing = (): void => {
    setEditing(null)
    setEditingName('')
    setRenameError(null)
  }

  const handleRename = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!editing) {
      return
    }
    const result = onRename(editing.id, editingName)
    if (!result.ok) {
      setRenameError(result.error)
      if (isNameError(result.error)) {
        editingNameRef.current?.focus()
      } else {
        // The category is gone. Close the form — but keep the message, which is
        // rendered below the list precisely so it outlives the row.
        setEditing(null)
        setEditingName('')
      }
      return
    }
    cancelEditing()
  }

  return (
    <section
      aria-labelledby={headingId}
      className="surface rounded-lg shadow-md p-6"
      data-testid={`category-section-${kind}`}
    >
      <h2 id={headingId} className="text-xl font-semibold text-subheading">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{description}</p>

      <form onSubmit={handleCreate} className="mt-4 flex flex-wrap items-start gap-2" noValidate>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={`categories-${kind}-new`} className="sr-only">
            New {kind} category name
          </label>
          <input
            ref={newNameRef}
            id={`categories-${kind}-new`}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={placeholder}
            /* ⚠️ Deliberately NO `maxLength`. Capping the input would make the
               `too-long` reason unreachable, and the store would still be the
               only thing enforcing the bound — an error the user could never
               see is an error that cannot be tested. */
            className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
            aria-invalid={createError !== null}
            aria-describedby={createError ? createErrorId : undefined}
            data-testid={`category-new-input-${kind}`}
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700"
          data-testid={`category-add-${kind}`}
        >
          Add category
        </button>
      </form>
      {createError && <ErrorMessage error={createError} id={createErrorId} />}

      {visibleCategories.length === 0 ? (
        <div className="surface-inset mt-4 rounded-lg p-6 text-center">
          <p className="text-muted">No {kind} categories yet</p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-gray-200 dark:divide-gray-700">
          {visibleCategories.map((category) => (
            <li key={category.id} className="py-3" data-testid={`category-row-${category.id}`}>
              {editing?.id === category.id ? (
                <form
                  onSubmit={handleRename}
                  className="flex flex-wrap items-start gap-2"
                  noValidate
                >
                  <div className="min-w-[12rem] flex-1">
                    <label htmlFor={`categories-edit-${category.id}`} className="sr-only">
                      Rename {category.name}
                    </label>
                    <input
                      ref={editingNameRef}
                      id={`categories-edit-${category.id}`}
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      aria-invalid={renameError !== null}
                      aria-describedby={renameError ? renameErrorId : undefined}
                      data-testid={`category-rename-input-${kind}`}
                    />
                  </div>
                  <button
                    type="submit"
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                    data-testid={`category-rename-save-${kind}`}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditing}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-heading">{category.name}</span>
                  <div className="flex shrink-0 items-center gap-4 text-sm">
                    <button
                      type="button"
                      onClick={() => startEditing(category)}
                      // `aria-label` REPLACES the subtree, so this string IS the
                      // whole accessible name. Without it a screen-reader user
                      // hears "Rename, Delete, Rename, Delete…" with nothing
                      // binding a destructive action to its target.
                      aria-label={`Rename ${category.name}`}
                      className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => onRequestDelete(category)}
                      aria-label={`Delete ${category.name}`}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {renameError && <ErrorMessage error={renameError} id={renameErrorId} />}
    </section>
  )
}
