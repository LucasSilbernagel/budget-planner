import { MAX_MONEY_CENTS } from '../finance/money-limits'
import { calculateProgress as calculateSavingsGoalProgress } from '../utils/savingsGoalCalculations'
import { generateUuid } from '../utils/uuid'

export interface ClientSavingsGoal {
  id: string
  // Null/absent means unscoped (visible under every profile). Not on ClientNew*: an edit
  // must never re-home a row.
  profileId?: string | null
  name: string
  // null ⇒ savings account (no target); never a sentinel 0.
  targetAmount: number | null
  currentBalance: number
  createdAt: string
  updatedAt: string
  // An order, not an index: deletes leave gaps. Optional because `toClientSavingsGoal` can't
  // see the list; the store stamps it right after.
  sortOrder?: number
  // Optional for legacy rows; absent means 'automatic' (see `resolveAllocationMode`).
  allocationMode?: AllocationMode
  monthlyAllocation?: number | null
  progress?: number | null
  status?: SavingsGoalStatus
}

export interface ClientNewSavingsGoal {
  name: string
  targetAmount: number | null
  currentBalance: number
  allocationMode?: AllocationMode
  monthlyAllocation?: number | null
}

export type SavingsGoalStatus = 'on-track' | 'behind' | 'complete' | 'not-started' | 'account'

/** 'automatic' takes an even share of the leftover pool; any stored `monthlyAllocation` is ignored. */
export type AllocationMode = 'manual' | 'automatic'

export function resolveAllocationMode(goal: { allocationMode?: AllocationMode }): AllocationMode {
  return goal.allocationMode ?? 'automatic'
}

export interface SavingsGoalWithProgress extends ClientSavingsGoal {
  progress: number | null
  status: SavingsGoalStatus
}

export function isSavingsAccount(goal: {
  targetAmount: number | null
}): boolean {
  return goal.targetAmount == null
}

export interface SavingsGoalFilter {
  status?: SavingsGoalStatus
  search?: string
}

export { calculateProgress } from '../utils/savingsGoalCalculations'

export function getStatusFromProgress(progress: number): SavingsGoalStatus {
  if (progress >= 100) return 'complete'
  if (progress > 0) return 'on-track'
  return 'not-started'
}

export function withProgress(savingsGoal: ClientSavingsGoal): SavingsGoalWithProgress {
  // null, never 0, so the UI can tell an account from 0% of a goal.
  if (isSavingsAccount(savingsGoal)) {
    return {
      ...savingsGoal,
      progress: null,
      status: 'account',
    }
  }

  const progress = calculateSavingsGoalProgress(
    savingsGoal.targetAmount as number,
    savingsGoal.currentBalance
  )
  return {
    ...savingsGoal,
    progress,
    status: getStatusFromProgress(progress),
  }
}

export interface ValidationError {
  field: string
  message: string
  value: unknown
}

export function validateSavingsGoal(input: Partial<ClientNewSavingsGoal>): ValidationError[] {
  const errors: ValidationError[] = []

  const isGoal = input.targetAmount !== undefined && input.targetAmount !== null

  if (input.name === undefined || input.name === null || input.name.trim() === '') {
    errors.push({
      field: 'name',
      message: 'Name is required',
      value: input.name,
    })
  } else if (input.name.length > 100) {
    errors.push({
      field: 'name',
      message: 'Name must be 100 characters or less',
      value: input.name,
    })
  }

  if (isGoal) {
    if (typeof input.targetAmount !== 'number' || !Number.isInteger(input.targetAmount)) {
      errors.push({
        field: 'targetAmount',
        message: 'Target amount must be an integer (in cents)',
        value: input.targetAmount,
      })
    } else if (input.targetAmount <= 0) {
      errors.push({
        field: 'targetAmount',
        message: 'Target amount must be positive',
        value: input.targetAmount,
      })
    } else if (input.targetAmount > MAX_MONEY_CENTS) {
      errors.push({
        field: 'targetAmount',
        message: 'Target amount exceeds the largest amount that can sync',
        value: input.targetAmount,
      })
    }
  }

  if (input.currentBalance === undefined || input.currentBalance === null) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance is required',
      value: input.currentBalance,
    })
  } else if (typeof input.currentBalance !== 'number' || !Number.isInteger(input.currentBalance)) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance must be an integer (in cents)',
      value: input.currentBalance,
    })
  } else if (input.currentBalance < 0) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance cannot be negative',
      value: input.currentBalance,
    })
  } else if (input.currentBalance > MAX_MONEY_CENTS) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance exceeds the largest amount that can sync',
      value: input.currentBalance,
    })
  } else if (
    isGoal &&
    typeof input.targetAmount === 'number' &&
    input.currentBalance > input.targetAmount
  ) {
    errors.push({
      field: 'currentBalance',
      message: 'Current balance cannot exceed target amount',
      value: input.currentBalance,
    })
  }

  // A manual amount is checked only in 'manual' mode: an automatic account ignores any
  // stored amount, so a stale one must not raise an error.
  if (input.allocationMode !== undefined) {
    if (input.allocationMode !== 'manual' && input.allocationMode !== 'automatic') {
      errors.push({
        field: 'allocationMode',
        message: 'Allocation mode must be "manual" or "automatic"',
        value: input.allocationMode,
      })
    }
  }

  if (
    input.allocationMode === 'manual' &&
    input.monthlyAllocation !== undefined &&
    input.monthlyAllocation !== null
  ) {
    if (typeof input.monthlyAllocation !== 'number' || !Number.isInteger(input.monthlyAllocation)) {
      errors.push({
        field: 'monthlyAllocation',
        message: 'Monthly allocation must be an integer (in cents)',
        value: input.monthlyAllocation,
      })
    } else if (input.monthlyAllocation < 0) {
      errors.push({
        field: 'monthlyAllocation',
        message: 'Monthly allocation cannot be negative',
        value: input.monthlyAllocation,
      })
    } else if (input.monthlyAllocation > MAX_MONEY_CENTS) {
      errors.push({
        field: 'monthlyAllocation',
        message: 'Monthly allocation exceeds the largest amount that can sync',
        value: input.monthlyAllocation,
      })
    }
  }

  return errors
}

export function isValidSavingsGoal(input: Partial<ClientNewSavingsGoal>): boolean {
  return validateSavingsGoal(input).length === 0
}

export function sortByCreationDate(goals: ClientSavingsGoal[]): ClientSavingsGoal[] {
  return [...goals].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA
  })
}

export function filterSavingsGoals(
  goals: SavingsGoalWithProgress[],
  filter: SavingsGoalFilter
): SavingsGoalWithProgress[] {
  return goals.filter((goal) => {
    if (filter.status && goal.status !== filter.status) return false
    if (filter.search) {
      const searchLower = filter.search.toLowerCase()
      if (!goal.name.toLowerCase().includes(searchLower)) return false
    }
    return true
  })
}

export function generateSavingsGoalTempId(): string {
  return generateUuid()
}

export function resetSavingsGoalTempId(): void {
  // Intentionally empty: uuid ids are stateless.
}

export function toClientSavingsGoal(
  input: ClientNewSavingsGoal,
  _userId?: number
): ClientSavingsGoal {
  const now = new Date().toISOString()
  return {
    ...input,
    id: generateSavingsGoalTempId(),
    createdAt: now,
    updatedAt: now,
  }
}
