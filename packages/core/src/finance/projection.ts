/**
 * Net Worth Projection Utilities
 *
 * Provides compound interest calculations for forward-looking net worth projections.
 * All calculations use monthly compounding periods as per project requirements.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Time horizon options for projections
 */
export type TimeHorizon = '1y' | '5y' | '10y' | 'custom'

/**
 * Input parameters for net worth projection
 */
export interface NetWorthProjectionInput {
  /** Current total assets in cents (to avoid floating point precision issues) */
  currentAssetsCents: number

  /** Current total liabilities in cents */
  currentLiabilitiesCents: number

  /** Monthly net income (income - expenses) in cents */
  monthlyNetIncomeCents: number

  /** Expected annual return rate on assets (as decimal, e.g., 0.07 for 7%) */
  assetReturnRate: number

  /** Expected annual growth rate for net income (as decimal) */
  incomeGrowthRate: number

  /** Time horizon for projection */
  timeHorizon: TimeHorizon

  /** Custom number of years (only used if timeHorizon === 'custom') */
  customYears?: number
}

/**
 * Single data point in a projection timeline
 */
export interface ProjectionPoint {
  /** Month number (0 = current, 1 = 1 month from now, etc.) */
  month: number

  /** Year number (0 = current, 1 = 1 year from now, etc.) */
  year: number

  /** Projected assets at this point in cents */
  assetsCents: number

  /** Projected liabilities at this point in cents */
  liabilitiesCents: number

  /** Projected net worth at this point in cents */
  netWorthCents: number

  /** Projected monthly net income at this point in cents */
  monthlyNetIncomeCents: number
}

/**
 * Complete projection result
 */
export interface NetWorthProjectionResult {
  /** Input parameters used for this projection */
  input: NetWorthProjectionInput

  /** Array of projection points, one per month */
  timeline: ProjectionPoint[]

  /** Summary statistics */
  summary: {
    /** Total number of months in projection */
    totalMonths: number

    /** Starting net worth in cents */
    startingNetWorthCents: number

    /** Ending net worth in cents */
    endingNetWorthCents: number

    /** Total growth in net worth in cents */
    totalGrowthCents: number

    /** Growth percentage (ending / starting) */
    growthPercentage: number

    /** Average monthly growth in cents */
    averageMonthlyGrowthCents: number
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates projection input parameters
 * @throws Error if validation fails
 */
function validateProjectionInput(input: NetWorthProjectionInput): void {
  // Check for negative values that don't make sense
  if (input.currentAssetsCents < 0) {
    throw new Error('Current assets cannot be negative')
  }

  if (input.currentLiabilitiesCents < 0) {
    throw new Error('Current liabilities cannot be negative')
  }

  // Asset return rate should be between -1 and a reasonable upper bound
  if (input.assetReturnRate < -1 || input.assetReturnRate > 1) {
    throw new Error('Asset return rate must be between -100% and +100%')
  }

  // Income growth rate should be reasonable
  if (input.incomeGrowthRate < -1 || input.incomeGrowthRate > 1) {
    throw new Error('Income growth rate must be between -100% and +100%')
  }

  // Custom years must be positive if provided
  if (input.timeHorizon === 'custom' && input.customYears !== undefined) {
    if (input.customYears <= 0) {
      throw new Error('Custom time horizon must be positive')
    }
    if (input.customYears > 50) {
      throw new Error('Custom time horizon cannot exceed 50 years')
    }
  }
}

/**
 * Converts time horizon to number of years
 */
function getYearsFromHorizon(horizon: TimeHorizon, customYears?: number): number {
  switch (horizon) {
    case '1y':
      return 1
    case '5y':
      return 5
    case '10y':
      return 10
    case 'custom':
      if (customYears === undefined || customYears <= 0) {
        throw new Error('Custom years must be provided for custom time horizon')
      }
      return customYears
    default:
      return 10
  }
}

// ============================================================================
// Core Calculation Functions
// ============================================================================

/**
 * Calculates the monthly return rate from an annual rate
 * Formula: monthlyRate = (1 + annualRate)^(1/12) - 1
 */
function calculateMonthlyRate(annualRate: number): number {
  if (annualRate === -1) {
    // Special case: -100% means everything goes to 0
    return -1
  }
  return (1 + annualRate) ** (1 / 12) - 1
}

/**
 * Calculates compound growth over a number of periods
 * Formula: futureValue = presentValue * (1 + rate)^periods
 */
function calculateCompoundGrowth(presentValue: number, rate: number, periods: number): number {
  if (periods === 0) {
    return presentValue
  }
  if (rate === -1) {
    // -100% rate means everything goes to 0
    return 0
  }
  return presentValue * (1 + rate) ** periods
}

// ============================================================================
// Main Projection Function
// ============================================================================

/**
 * Creates a net worth projection timeline
 *
 * Calculates month-by-month projection of net worth based on:
 * - Current assets and liabilities
 * - Monthly net income (which can grow over time)
 * - Asset return rate (compounded monthly)
 *
 * The calculation for each month:
 * - Assets grow by the monthly return rate, but only while the balance is positive
 * - New net income is added (growing at incomeGrowthRate)
 * - The new net income itself earns returns in subsequent months
 *
 * A sustained spending deficit (negative monthly net income) can drain assets past zero.
 * The resulting negative balance is an accumulated shortfall, not an investment, so it
 * does not earn the return rate — it accumulates linearly. Compounding it would make the
 * shortfall grow geometrically, which is the same defect FR47 removes from the net-worth
 * line, relocated to the asset line.
 *
 * @param input - Projection input parameters
 * @returns Complete projection result with timeline and summary
 */
export function createNetWorthProjection(input: NetWorthProjectionInput): NetWorthProjectionResult {
  // Validate input
  validateProjectionInput(input)

  // Get total years
  const totalYears = getYearsFromHorizon(input.timeHorizon, input.customYears)
  const totalMonths = Math.floor(totalYears * 12)

  // Calculate rates
  const monthlyAssetRate = calculateMonthlyRate(input.assetReturnRate)
  const monthlyIncomeGrowthRate = calculateMonthlyRate(input.incomeGrowthRate)

  // Initialize
  const timeline: ProjectionPoint[] = []
  let currentAssetsCents = input.currentAssetsCents
  const currentLiabilitiesCents = input.currentLiabilitiesCents
  let currentMonthlyNetIncomeCents = input.monthlyNetIncomeCents

  // Calculate starting net worth
  const startingNetWorthCents = currentAssetsCents - currentLiabilitiesCents

  // Build timeline month by month
  // We always have at least month 0, so timeline will never be empty
  for (let month = 0; month <= totalMonths; month++) {
    const year = Math.floor(month / 12)

    // For months > 0, apply compounding to assets
    if (month > 0) {
      // Assets grow by the monthly rate — but only a positive balance earns a return.
      // A negative balance here is an accumulated shortfall from spending more than is
      // earned; charging it the return rate would compound the shortfall geometrically.
      if (currentAssetsCents > 0) {
        currentAssetsCents = Math.round(
          calculateCompoundGrowth(currentAssetsCents, monthlyAssetRate, 1)
        )
      }

      // Add new net income for this month
      currentAssetsCents += currentMonthlyNetIncomeCents

      // Income grows at its own rate
      currentMonthlyNetIncomeCents = Math.round(
        calculateCompoundGrowth(currentMonthlyNetIncomeCents, monthlyIncomeGrowthRate, 1)
      )
    }

    const netWorthCents = currentAssetsCents - currentLiabilitiesCents

    timeline.push({
      month,
      year,
      assetsCents: currentAssetsCents,
      liabilitiesCents: currentLiabilitiesCents,
      netWorthCents,
      monthlyNetIncomeCents: currentMonthlyNetIncomeCents,
    })
  }

  // Calculate summary
  // timeline always has at least one element (month 0 was pushed above)
  const timelineLength = timeline.length
  // Safe to use non-null assertion - loop always runs at least once (month = 0)
  // biome-ignore lint/style/noNonNullAssertion: month 0 is always pushed, so timeline is non-empty; ?. would widen lastPoint to undefined and break the .netWorthCents access below.
  const lastPoint = timeline[timelineLength - 1]!
  const endingNetWorthCents = lastPoint.netWorthCents
  const totalGrowthCents = endingNetWorthCents - startingNetWorthCents
  const growthPercentage =
    startingNetWorthCents !== 0 ? (endingNetWorthCents / startingNetWorthCents) * 100 : 0
  const averageMonthlyGrowthCents = totalMonths > 0 ? Math.round(totalGrowthCents / totalMonths) : 0

  return {
    input: {
      ...input,
      // Normalize customYears in output
      customYears: input.timeHorizon === 'custom' ? input.customYears : undefined,
    },
    timeline,
    summary: {
      totalMonths,
      startingNetWorthCents,
      endingNetWorthCents,
      totalGrowthCents,
      growthPercentage,
      averageMonthlyGrowthCents,
    },
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Projects net worth with simplified inputs (no liabilities, fixed income)
 */
export function projectNetWorthSimple(
  currentNetWorthCents: number,
  monthlySavingsCents: number,
  annualReturnRate: number,
  years: number
): NetWorthProjectionResult {
  return createNetWorthProjection({
    currentAssetsCents: currentNetWorthCents,
    currentLiabilitiesCents: 0,
    monthlyNetIncomeCents: monthlySavingsCents,
    assetReturnRate: annualReturnRate,
    incomeGrowthRate: 0,
    timeHorizon: 'custom',
    customYears: years,
  })
}

/**
 * Calculates how long it will take to reach a target net worth
 * Uses iterative approach to find the month when target is reached
 */
export function calculateYearsToNetWorthTarget(
  currentNetWorthCents: number,
  monthlySavingsCents: number,
  annualReturnRate: number,
  targetNetWorthCents: number,
  maxYears = 50
): number | null {
  if (currentNetWorthCents >= targetNetWorthCents) {
    return 0
  }

  if (monthlySavingsCents <= 0 && annualReturnRate <= 0) {
    // No growth possible
    return null
  }

  const result = createNetWorthProjection({
    currentAssetsCents: currentNetWorthCents,
    currentLiabilitiesCents: 0,
    monthlyNetIncomeCents: monthlySavingsCents,
    assetReturnRate: annualReturnRate,
    incomeGrowthRate: 0,
    timeHorizon: 'custom',
    customYears: maxYears,
  })

  // Find the first point where net worth reaches or exceeds target
  for (const point of result.timeline) {
    if (point.netWorthCents >= targetNetWorthCents) {
      return point.year + point.month / 12
    }
  }

  // Target not reached within maxYears
  return null
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for NetWorthProjectionInput
 */
export function isNetWorthProjectionInput(obj: unknown): obj is NetWorthProjectionInput {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'currentAssetsCents' in obj &&
    'currentLiabilitiesCents' in obj &&
    'monthlyNetIncomeCents' in obj &&
    'assetReturnRate' in obj &&
    'incomeGrowthRate' in obj &&
    'timeHorizon' in obj
  )
}

/**
 * Type guard for TimeHorizon
 */
export function isTimeHorizon(value: unknown): value is TimeHorizon {
  return typeof value === 'string' && ['1y', '5y', '10y', 'custom'].includes(value)
}
