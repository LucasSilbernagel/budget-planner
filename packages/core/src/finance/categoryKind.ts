import type { CategoryKind as DbCategoryKind } from '@budget-planner/db/schema'
import type { SameMembers } from '../utils/enum-parity'

export const CATEGORY_KINDS = ['income', 'expense'] as const

export type CategoryKind = (typeof CATEGORY_KINDS)[number]

const _categoryKindParity: SameMembers<CategoryKind, DbCategoryKind> = true
void _categoryKindParity
