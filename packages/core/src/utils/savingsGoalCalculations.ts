/**
 * Savings Goal Calculations Utility
 * 
 * Pure calculation functions for savings goal progress and related metrics.
 * Used for display and business logic.
 * 
 * Architecture: Pure TypeScript functions, no side effects
 */

/**
 * Calculate progress percentage for a savings goal
 * 
 * @param targetAmount - Target amount in cents (must be positive)
 * @param currentBalance - Current balance in cents (can be 0)
 * @returns Progress percentage (0-100), rounded to nearest integer, capped at 100
 * 
 * @example
 * // AC 5: Given targetAmount = $1000 and currentBalance = $600, returns 60%
 * calculateProgress(100000, 60000) // Returns 60
 * 
 * @example
 * // AC 6: Given targetAmount = $1000 and currentBalance = $0, returns 0%
 * calculateProgress(100000, 0) // Returns 0
 * 
 * @example
 * // AC 7: Given targetAmount = $1000 and currentBalance = $1000, returns 100%
 * calculateProgress(100000, 100000) // Returns 100
 */
export function calculateProgress(targetAmount: number, currentBalance: number): number {
  // Guard: prevent division by zero and handle invalid targets
  if (targetAmount <= 0) return 0
  
  // Cap currentBalance to prevent > 100% progress
  const cappedBalance = Math.min(currentBalance, targetAmount)
  
  // Calculate percentage and round to nearest integer
  return Math.round((cappedBalance / targetAmount) * 100)
}

/**
 * Format percentage for display
 * 
 * @param percentage - Percentage value (0-100)
 * @returns Formatted string with % sign
 * 
 * @example
 * formatPercentage(60) // Returns "60%"
 * formatPercentage(0) // Returns "0%"
 * formatPercentage(100) // Returns "100%"
 */
export function formatPercentage(percentage: number): string {
  return `${percentage}%`
}

/**
 * Calculate remaining amount to reach target
 * 
 * @param targetAmount - Target amount in cents
 * @param currentBalance - Current balance in cents
 * @returns Remaining amount in cents (0 if target already reached)
 */
export function calculateRemaining(targetAmount: number, currentBalance: number): number {
  return Math.max(0, targetAmount - currentBalance)
}

/**
 * Calculate the amount needed per month to reach target in a given timeframe
 * 
 * @param targetAmount - Target amount in cents
 * @param currentBalance - Current balance in cents
 * @param months - Number of months to reach target
 * @returns Monthly savings amount in cents
 */
export function calculateMonthlySavingsNeeded(
  targetAmount: number,
  currentBalance: number,
  months: number
): number {
  if (months <= 0) return 0
  const remaining = calculateRemaining(targetAmount, currentBalance)
  return Math.ceil(remaining / months)
}

/**
 * Determine if a savings goal is on track based on time and contributions
 * 
 * @param targetAmount - Target amount in cents
 * @param currentBalance - Current balance in cents
 * @param targetDate - Target date as ISO string or Date object
 * @returns true if on track, false otherwise
 */
export function isOnTrack(
  targetAmount: number,
  currentBalance: number,
  targetDate: string | Date
): boolean {
  const targetDateTime = typeof targetDate === 'string' ? new Date(targetDate).getTime() : targetDate.getTime()
  const now = Date.now()
  const monthsRemaining = (targetDateTime - now) / (1000 * 60 * 60 * 24 * 30)
  
  if (monthsRemaining <= 0) return currentBalance >= targetAmount
  
  const monthlyNeeded = calculateMonthlySavingsNeeded(targetAmount, currentBalance, monthsRemaining)
  // For now, just check if goal is complete or if there's positive progress
  // More sophisticated tracking would need contribution history
  return currentBalance > 0 || monthlyNeeded === 0
}

/**
 * Get progress status based on percentage
 * 
 * @param progress - Progress percentage (0-100)
 * @returns Human-readable status string
 */
export function getProgressStatus(progress: number): string {
  if (progress >= 100) return 'Complete'
  if (progress >= 75) return 'On Track'
  if (progress >= 25) return 'In Progress'
  if (progress > 0) return 'Started'
  return 'Not Started'
}

/**
 * Savings Goal Progress Information
 * Combined progress data for display
 */
export interface SavingsGoalProgressInfo {
  percentage: number
  formattedPercentage: string
  remainingAmount: number
  status: string
  isComplete: boolean
}

/**
 * Calculate comprehensive progress information for a savings goal
 * 
 * @param targetAmount - Target amount in cents
 * @param currentBalance - Current balance in cents
 * @returns Progress information object
 */
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
