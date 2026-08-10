/**
 * A row's assigned category, as a table cell (story 30.4b, AC-1/AC-3).
 *
 * Shared by the income and expense tables so the "unresolvable id reads as
 * uncategorized" rule (AC-3) is written once. Both a missing `categoryId` and
 * one this device cannot resolve render the same placeholder — never blank,
 * never the raw uuid.
 */

import type React from 'react'
import { resolveCategoryName } from '../../hooks/useCategoryLabels'

export interface CategoryBadgeProps {
  categoryId: string | null | undefined
  names: ReadonlyMap<string, string>
  /** Namespaces the test ids, e.g. `income` → `income-row-category`. */
  idPrefix: string
}

export function CategoryBadge({
  categoryId,
  names,
  idPrefix,
}: CategoryBadgeProps): React.ReactElement {
  const name = resolveCategoryName(categoryId, names)

  if (!name) {
    return (
      <span className="text-sm text-faint" data-testid={`${idPrefix}-row-uncategorized`}>
        —
      </span>
    )
  }

  return (
    <span
      className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
      data-testid={`${idPrefix}-row-category`}
    >
      {name}
    </span>
  )
}
