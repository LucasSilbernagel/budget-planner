/**
 * Unit tests for Net Worth Projection Utilities
 * 
 * Tests cover:
 * - Basic projection calculations
 * - Compound interest accuracy
 * - Edge cases (zero values, negative rates)
 * - Validation errors
 * - Time horizon handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createNetWorthProjection,
  projectNetWorthSimple,
  calculateYearsToNetWorthTarget,
  NetWorthProjectionInput,
  TimeHorizon,
  isNetWorthProjectionInput,
  isTimeHorizon,
} from './projection';

// ============================================================================
// Test Constants
// ============================================================================

// Convert dollars to cents for testing
const toCents = (dollars: number): number => Math.round(dollars * 100);

// Base test input: $100,000 assets, $0 liabilities, $5,000 monthly net income, 7% return
const BASE_INPUT: NetWorthProjectionInput = {
  currentAssetsCents: toCents(100000),
  currentLiabilitiesCents: toCents(0),
  monthlyNetIncomeCents: toCents(5000),
  assetReturnRate: 0.07, // 7% annual
  incomeGrowthRate: 0.03, // 3% annual income growth
  timeHorizon: '10y',
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate expected future value with compound interest
 * FV = PV * (1 + r/n)^(nt)
 * For monthly compounding: FV = PV * (1 + annualRate/12)^(12*years)
 */
function calculateExpectedFV(
  presentValue: number,
  annualRate: number,
  years: number
): number {
  const monthlyRate = Math.pow(1 + annualRate, 1/12) - 1;
  const months = years * 12;
  return presentValue * Math.pow(1 + monthlyRate, months);
}

/**
 * Calculate future value of an annuity (series of payments)
 * FV = PMT * (((1 + r)^n - 1) / r)
 */
function calculateExpectedFVAnnuity(
  payment: number,
  annualRate: number,
  years: number
): number {
  const monthlyRate = Math.pow(1 + annualRate, 1/12) - 1;
  const months = years * 12;
  
  if (monthlyRate === 0) {
    return payment * months;
  }
  
  return payment * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

// ============================================================================
// Validation Tests
// ============================================================================

describe('Projection Input Validation', () => {
  it('should accept valid input without throwing', () => {
    expect(() => createNetWorthProjection(BASE_INPUT)).not.toThrow();
  });

  it('should throw error for negative current assets', () => {
    const invalidInput = { ...BASE_INPUT, currentAssetsCents: toCents(-1000) };
    expect(() => createNetWorthProjection(invalidInput)).toThrow(
      'Current assets cannot be negative'
    );
  });

  it('should throw error for negative current liabilities', () => {
    const invalidInput = { ...BASE_INPUT, currentLiabilitiesCents: toCents(-1000) };
    expect(() => createNetWorthProjection(invalidInput)).toThrow(
      'Current liabilities cannot be negative'
    );
  });

  it('should throw error for asset return rate below -100%', () => {
    const invalidInput = { ...BASE_INPUT, assetReturnRate: -1.5 };
    expect(() => createNetWorthProjection(invalidInput)).toThrow(
      'Asset return rate must be between -100% and +100%'
    );
  });

  it('should throw error for asset return rate above +100%', () => {
    const invalidInput = { ...BASE_INPUT, assetReturnRate: 1.5 };
    expect(() => createNetWorthProjection(invalidInput)).toThrow(
      'Asset return rate must be between -100% and +100%'
    );
  });

  it('should throw error for income growth rate below -100%', () => {
    const invalidInput = { ...BASE_INPUT, incomeGrowthRate: -1.5 };
    expect(() => createNetWorthProjection(invalidInput)).toThrow(
      'Income growth rate must be between -100% and +100%'
    );
  });

  it('should throw error for custom time horizon without customYears', () => {
    const invalidInput: NetWorthProjectionInput = {
      ...BASE_INPUT,
      timeHorizon: 'custom',
      // customYears is undefined
    };
    expect(() => createNetWorthProjection(invalidInput)).toThrow(
      'Custom years must be provided for custom time horizon'
    );
  });

  it('should throw error for custom time horizon with zero years', () => {
    const invalidInput: NetWorthProjectionInput = {
      ...BASE_INPUT,
      timeHorizon: 'custom',
      customYears: 0,
    };
    expect(() => createNetWorthProjection(invalidInput)).toThrow(
      'Custom time horizon must be positive'
    );
  });

  it('should throw error for custom time horizon exceeding 50 years', () => {
    const invalidInput: NetWorthProjectionInput = {
      ...BASE_INPUT,
      timeHorizon: 'custom',
      customYears: 51,
    };
    expect(() => createNetWorthProjection(invalidInput)).toThrow(
      'Custom time horizon cannot exceed 50 years'
    );
  });
});

// ============================================================================
// Basic Projection Tests
// ============================================================================

describe('Basic Projection Calculations', () => {
  it('should create a projection with 1 year horizon', () => {
    const input: NetWorthProjectionInput = {
      ...BASE_INPUT,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    
    expect(result.timeline.length).toBe(13); // 12 months + month 0
    expect(result.summary.totalMonths).toBe(12);
  });

  it('should create a projection with 5 year horizon', () => {
    const input: NetWorthProjectionInput = {
      ...BASE_INPUT,
      timeHorizon: '5y',
    };
    
    const result = createNetWorthProjection(input);
    
    expect(result.timeline.length).toBe(61); // 60 months + month 0
    expect(result.summary.totalMonths).toBe(60);
  });

  it('should create a projection with 10 year horizon', () => {
    const result = createNetWorthProjection(BASE_INPUT);
    
    expect(result.timeline.length).toBe(121); // 120 months + month 0
    expect(result.summary.totalMonths).toBe(120);
  });

  it('should create a projection with custom time horizon', () => {
    const input: NetWorthProjectionInput = {
      ...BASE_INPUT,
      timeHorizon: 'custom',
      customYears: 3,
    };
    
    const result = createNetWorthProjection(input);
    
    expect(result.timeline.length).toBe(37); // 36 months + month 0
    expect(result.summary.totalMonths).toBe(36);
  });

  it('should have correct starting net worth', () => {
    const result = createNetWorthProjection(BASE_INPUT);
    
    expect(result.timeline[0].netWorthCents).toBe(toCents(100000));
    expect(result.summary.startingNetWorthCents).toBe(toCents(100000));
  });

  it('should calculate assets compounding correctly over time', () => {
    // Start with $10,000, 12% annual return, no additional contributions
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(10000),
      currentLiabilitiesCents: toCents(0),
      monthlyNetIncomeCents: toCents(0), // No additional contributions
      assetReturnRate: 0.12,
      incomeGrowthRate: 0,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    
    // After 12 months at 12% annual compounded monthly
    // Expected: 10000 * (1 + 0.12/12)^12 = 10000 * 1.126825 = $11,268.25
    const expectedFV = 10000 * Math.pow(1 + 0.12, 1);
    const expectedCents = Math.round(expectedFV * 100);
    
    const endingAssets = result.timeline[12].assetsCents;
    const tolerance = 2; // Allow for rounding differences
    
    expect(endingAssets).toBeCloseTo(expectedCents, tolerance);
  });
});

// ============================================================================
// Compound Interest Tests
// ============================================================================

describe('Compound Interest Accuracy', () => {
  it('should correctly calculate compound interest with monthly compounding', () => {
    // Test with known values: $1000 at 12% annual, compounded monthly for 1 year
    // Expected: 1000 * (1 + 0.12)^1 = 1120 (since we use annual compounding in the formula)
    // But we're doing monthly compounding: (1 + 0.12/12)^12 = 1.126825
    // So: 1000 * 1.126825 = 1126.825
    
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(1000),
      currentLiabilitiesCents: toCents(0),
      monthlyNetIncomeCents: toCents(0),
      assetReturnRate: 0.12,
      incomeGrowthRate: 0,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    const endingNetWorth = result.timeline[12].netWorthCents / 100; // Convert back to dollars
    
    // Expected after 12 months of compounding
    const expectedMonthlyRate = Math.pow(1 + 0.12, 1/12) - 1;
    const expectedValue = 1000 * Math.pow(1 + expectedMonthlyRate, 12);
    
    // Should be approximately $1126.83
    expect(endingNetWorth).toBeCloseTo(1126.83, 0.01);
  });

  it('should handle zero return rate correctly', () => {
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(10000),
      currentLiabilitiesCents: toCents(0),
      monthlyNetIncomeCents: toCents(1000),
      assetReturnRate: 0, // 0% return
      incomeGrowthRate: 0,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    
    // With 0% return, assets should just accumulate the monthly contributions
    // Starting: $10,000
    // After 12 months: $10,000 + ($1,000 * 12) = $22,000
    const endingNetWorth = result.timeline[12].netWorthCents / 100;
    
    expect(endingNetWorth).toBe(22000);
  });

  it('should handle negative return rate correctly', () => {
    // Test with -50% return (losing half the value each year)
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(10000),
      currentLiabilitiesCents: toCents(0),
      monthlyNetIncomeCents: toCents(0),
      assetReturnRate: -0.5,
      incomeGrowthRate: 0,
      timeHorizon: '2y',
    };
    
    const result = createNetWorthProjection(input);
    
    // After 2 years at -50% annual, compounded monthly
    // Monthly rate: (1 - 0.5)^(1/12) - 1 = -0.04811
    // After 24 months: 10000 * (1 - 0.04811)^24 ≈ 10000 * 0.3715 ≈ 3715
    const endingNetWorth = result.timeline[24].netWorthCents / 100;
    
    // Should be less than starting value
    expect(endingNetWorth).toBeLessThan(10000);
    expect(endingNetWorth).toBeGreaterThan(0);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle zero starting assets', () => {
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(0),
      currentLiabilitiesCents: toCents(0),
      monthlyNetIncomeCents: toCents(1000),
      assetReturnRate: 0.07,
      incomeGrowthRate: 0,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    
    expect(result.summary.startingNetWorthCents).toBe(0);
    // Should grow from contributions only
    expect(result.timeline[12].netWorthCents).toBeGreaterThan(0);
  });

  it('should handle zero monthly net income', () => {
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(10000),
      currentLiabilitiesCents: toCents(0),
      monthlyNetIncomeCents: toCents(0),
      assetReturnRate: 0.07,
      incomeGrowthRate: 0,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    
    // Should only grow from compounding of initial assets
    expect(result.timeline[12].netWorthCents).toBeGreaterThan(toCents(10000));
  });

  it('should handle liabilities correctly', () => {
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(100000),
      currentLiabilitiesCents: toCents(50000), // $50k debt
      monthlyNetIncomeCents: toCents(5000),
      assetReturnRate: 0.07,
      incomeGrowthRate: 0,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    
    // Starting net worth should be $50k
    expect(result.summary.startingNetWorthCents).toBe(toCents(50000));
    
    // Liabilities should remain constant (not growing)
    expect(result.timeline[12].liabilitiesCents).toBe(toCents(50000));
  });

  it('should handle -100% return rate (everything goes to zero)', () => {
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(10000),
      currentLiabilitiesCents: toCents(0),
      monthlyNetIncomeCents: toCents(0),
      assetReturnRate: -1, // -100%
      incomeGrowthRate: 0,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    
    // After any period with -100% rate, assets should go to 0
    expect(result.timeline[12].assetsCents).toBe(0);
  });
});

// ============================================================================
// Years to Target Tests
// ============================================================================

describe('Years to Target Calculation', () => {
  it('should return 0 if already at target', () => {
    const years = calculateYearsToNetWorthTarget(
      toCents(100000),
      toCents(0),
      0.07,
      toCents(100000)
    );
    
    expect(years).toBe(0);
  });

  it('should return null if target cannot be reached', () => {
    const years = calculateYearsToNetWorthTarget(
      toCents(100000),
      toCents(0),
      0, // 0% return
      toCents(200000) // Target is higher with no growth
    );
    
    expect(years).toBeNull();
  });

  it('should return null if no savings and negative return', () => {
    const years = calculateYearsToNetWorthTarget(
      toCents(100000),
      toCents(-1000), // Negative savings (withdrawing)
      -0.1, // Negative return
      toCents(200000)
    );
    
    expect(years).toBeNull();
  });

  it('should calculate years to reach a target with positive growth', () => {
    // Starting at $100k, saving $5k/month, 7% return
    // Target: $500k
    const years = calculateYearsToNetWorthTarget(
      toCents(100000),
      toCents(5000),
      0.07,
      toCents(500000)
    );
    
    // Should be able to reach the target in some number of years
    expect(years).toBeGreaterThan(0);
    expect(years).toBeLessThan(20);
  });
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  it('should correctly identify TimeHorizon values', () => {
    expect(isTimeHorizon('1y')).toBe(true);
    expect(isTimeHorizon('5y')).toBe(true);
    expect(isTimeHorizon('10y')).toBe(true);
    expect(isTimeHorizon('custom')).toBe(true);
    expect(isTimeHorizon('invalid')).toBe(false);
    expect(isTimeHorizon(123)).toBe(false);
  });

  it('should correctly identify NetWorthProjectionInput objects', () => {
    expect(isNetWorthProjectionInput(BASE_INPUT)).toBe(true);
    expect(isNetWorthProjectionInput({})).toBe(false);
    expect(isNetWorthProjectionInput(null)).toBe(false);
    expect(isNetWorthProjectionInput(undefined)).toBe(false);
  });
});

// ============================================================================
// Summary Statistics Tests
// ============================================================================

describe('Summary Statistics', () => {
  it('should calculate correct summary statistics', () => {
    const result = createNetWorthProjection(BASE_INPUT);
    
    expect(result.summary.startingNetWorthCents).toBe(toCents(100000));
    expect(result.summary.endingNetWorthCents).toBe(
      result.timeline[result.timeline.length - 1].netWorthCents
    );
    expect(result.summary.totalGrowthCents).toBe(
      result.summary.endingNetWorthCents - result.summary.startingNetWorthCents
    );
    
    // Growth percentage calculation
    const expectedGrowthPct = 
      (result.summary.endingNetWorthCents / result.summary.startingNetWorthCents) * 100;
    expect(result.summary.growthPercentage).toBeCloseTo(expectedGrowthPct, 0.01);
  });

  it('should handle division by zero for growth percentage', () => {
    const input: NetWorthProjectionInput = {
      currentAssetsCents: toCents(0),
      currentLiabilitiesCents: toCents(0),
      monthlyNetIncomeCents: toCents(1000),
      assetReturnRate: 0.07,
      incomeGrowthRate: 0,
      timeHorizon: '1y',
    };
    
    const result = createNetWorthProjection(input);
    
    // Should not throw, should return 0 for growth percentage
    expect(result.summary.growthPercentage).toBe(0);
  });
});

// ============================================================================
// Simplified Function Tests
// ============================================================================

describe('Simplified Projection Function', () => {
  it('should create projection with simplified inputs', () => {
    const result = projectNetWorthSimple(
      toCents(100000),
      toCents(5000),
      0.07,
      10
    );
    
    expect(result.summary.startingNetWorthCents).toBe(toCents(100000));
    expect(result.summary.totalMonths).toBe(120);
    expect(result.input.currentLiabilitiesCents).toBe(0);
    expect(result.input.incomeGrowthRate).toBe(0);
  });
});
