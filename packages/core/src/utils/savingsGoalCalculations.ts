export function calculateProgress(targetAmount: number, currentBalance: number): number {
  if (targetAmount <= 0) return 0

  const cappedBalance = Math.min(currentBalance, targetAmount)

  return Math.round((cappedBalance / targetAmount) * 100)
}

export function formatPercentage(percentage: number): string {
  return `${percentage}%`
}

export function calculateRemaining(targetAmount: number, currentBalance: number): number {
  return Math.max(0, targetAmount - currentBalance)
}

export function calculateMonthlySavingsNeeded(
  targetAmount: number,
  currentBalance: number,
  months: number
): number {
  if (months <= 0) return 0
  const remaining = calculateRemaining(targetAmount, currentBalance)
  return Math.ceil(remaining / months)
}

export function getProgressStatus(progress: number): string {
  if (progress >= 100) return 'Complete'
  if (progress >= 75) return 'On Track'
  if (progress >= 25) return 'In Progress'
  if (progress > 0) return 'Started'
  return 'Not Started'
}

export interface SavingsGoalProgressInfo {
  percentage: number
  formattedPercentage: string
  remainingAmount: number
  status: string
  isComplete: boolean
}

export function getProgressInfo(
  targetAmount: number,
  currentBalance: number
): SavingsGoalProgressInfo {
  const percentage = calculateProgress(targetAmount, currentBalance)
  return {
    percentage,
    formattedPercentage: formatPercentage(percentage),
    remainingAmount: calculateRemaining(targetAmount, currentBalance),
    status: getProgressStatus(percentage),
    isComplete: percentage >= 100,
  }
}
