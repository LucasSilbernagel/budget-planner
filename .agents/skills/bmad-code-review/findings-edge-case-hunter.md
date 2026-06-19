# Edge Case Hunter Findings - Story 3-1

**Role:** Edge case reviewer with diff + project read access  
**Date:** 2026-06-18  
**Project:** budget-planner (monorepo with pnpm workspaces)  
**Diff:** +850 lines across 4 files

---

## Critical Edge Cases

### 1. **Zero Income Edge Case Not Fully Handled**
**Severity:** Critical  
**Location:** `apps/web/src/components/RetirementForm.tsx:287-290`  
**Evidence:**
```typescript
if (monthlyIncomeCents === 0) {
  setError('Please enter a valid monthly income')
  setRequiredAssets(null)
  return
}
```
**Edge Case:** User enters exactly "0" or "0.00" as monthly income  
**Problem:** The validation returns 0 from `parseCurrencyToCents("0")`, which triggers the error. However, a user might legitimately want to test "what if I have no income?" - the system should either allow it (with appropriate messaging) or provide a clearer error.

**Project Context:** The project-context.md states "Handle zero and negative values in financial calculations" (Edge Cases section). This is partially violated.

**Recommendation:** Allow 0 as valid input but display a message that with 0 income, 0 assets are needed. Or add a minimum value (> 0) validation.

---

### 2. **Division by Zero in Formula Still Possible**
**Severity:** Critical  
**Location:** `packages/core/src/finance/retirement.ts:87-99` (existing file, but integrated)  
**Evidence:** The existing `calculateRequiredAssets` function throws when `annualReturnRate <= 0`  
**Edge Case:** User enters exactly 0% return rate  
**Problem:** While `parsePercentageToDecimal` returns 0 for "0", and there's validation in RetirementForm, the underlying function will throw with "Annual return rate must be positive (greater than 0)". The error message in the UI doesn't match the underlying error.

**Project Context:** project-context.md: "Handle zero and negative values in financial calculations" - NFR3 (Zero tolerance for mathematical errors)

**Recommendation:** The validation is correct, but the error message should be consistent. Consider catching the specific error from `calculateRequiredAssets` and displaying a more user-friendly message.

---

### 3. **Negative Values in Form Inputs Not Blocked**
**Severity:** Critical  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:702-727`  
**Evidence:**
```typescript
<input
  type="number"
  id="principal"
  value={principal}
  onChange={handlePrincipalChange}
  min="0"
  step="1000"
/>
```
**Edge Case:** User can still type negative numbers despite `min="0"` (HTML5 validation is client-side only and can be bypassed)  
**Problem:** The `handlePrincipalChange` function uses `parseFloat(e.target.value) || 0`, which will accept negative values. Negative principal doesn't make sense for retirement planning.

**Project Context:** project-context.md: "Handle zero and negative values in financial calculations"

**Recommendation:** Add explicit validation: `setPrincipal(Math.max(0, value))` or display error for negative values.

---

### 4. **Very Large Numbers Cause Display Issues**
**Severity:** High  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:525-533`  
**Evidence:**
```typescript
function formatChartCurrency(value: number, mode: string, currency: string): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`
  }
  return formatCurrency(value, { mode, currency })
}
```
**Edge Case:** User enters $100M+ or very large contribution amounts  
**Problem:** For values >= $1000M, the format becomes `$1000.0M` which is hard to read. For extremely large numbers (Number.MAX_SAFE_INTEGER), the display breaks entirely.

**Project Context:** Financial calculations should handle edge cases per project-context.md

**Recommendation:** Use a logarithmic scale or scientific notation for extremely large values. Add input limits.

---

### 5. **Very Small Return Rates Cause Overflow**
**Severity:** High  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:615-620`  
**Evidence:**
```typescript
annualReturnRate: returnRate / 100, // Convert percentage to decimal
```
**Edge Case:** User enters 0.001% return rate  
**Problem:** With the formula FV = Ir × (12 / r), a very small r causes FV to be enormous. For r=0.00001 (0.001%), FV = Ir × 1,200,000. This could cause number overflow or display issues.

**Project Context:** project-context.md: "Handle zero and negative values in financial calculations"

**Recommendation:** Add minimum return rate validation (e.g., >= 0.01%) and warn users about unrealistic rates.

---

### 6. **Very Long Projections (100+ Years)**
**Severity:** High  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:658-661`  
**Evidence:**
```typescript
const handleYearsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  const value = parseInt(e.target.value, 10) || 0
  setYears(Math.max(value, 1))
}, [])
```
**Edge Case:** User enters 1000 years  
**Problem:** The chart will try to render 1000 data points, which will be slow and potentially crash the browser. The `ResponsiveContainer` has fixed height but the X-axis will be unreadable.

**Project Context:** Performance gotcha: "Client-side calculations must be optimized" (project-context.md)

**Recommendation:** Add maximum limit (e.g., max 100 years) and warn user. Consider pagination or lazy rendering for large datasets.

---

### 7. **Age Edge Cases Not Validated**
**Severity:** High  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:663-671`  
**Evidence:**
```typescript
const handleCurrentAgeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  const value = parseInt(e.target.value, 10) || 0
  setCurrentAge(Math.max(value, 18))
}, [])

const handleRetirementAgeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  const value = parseInt(e.target.value, 10) || 0
  setRetirementAge(Math.max(value, currentAgeState + 1))
}, [currentAgeState])
```
**Edge Cases:**
- Current age > retirement age (race condition if both change rapidly)
- Retirement age > 120 (max input is 120, but could be higher)
- Current age = retirement age (invalid state)
- Negative ages (parseInt("") = 0, but 0 < 18)

**Project Context:** Edge cases should be handled (project-context.md)

**Recommendation:** Add comprehensive age validation: currentAge < retirementAge, both >= 18 and <= 120.

---

### 8. **Currency Formatting Edge Cases**
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementForm.tsx:180-204`  
**Evidence:**
```typescript
function parseCurrencyToCents(value: string): number {
  // ...
  if (cleaned.includes('.')) {
    const [whole, decimal] = cleaned.split('.')
    const paddedDecimal = decimal.padEnd(2, '0').slice(0, 2)
    return parseInt(whole + paddedDecimal, 10) || 0
  }
  return parseInt(cleaned + '00', 10) || 0
}
```
**Edge Cases:**
- Input: ".50" (no whole number part) → cleaned = "0.50" → whole="0", decimal="50" → 050 = 50 cents ✓
- Input: "123" (no decimal) → 12300 cents ✓  
- Input: "123." (decimal with no digits) → cleaned="123." → decimal="" → paddedDecimal="00" → 12300 cents ✓
- Input: "123.4" (one decimal digit) → decimal="4" → padded="40" → 12340 cents ✓
- Input: "123.456" (three decimal digits) → decimal="456" → padded="45" → 12345 cents (truncates) ⚠️

**Issue:** Three decimal digits are silently truncated to two. User enters "$1.234" expecting $1.234 but gets $1.23.

**Project Context:** Currency control system should handle different formats (project-context.md)

**Recommendation:** Round instead of truncate, or display warning for >2 decimal places.

---

### 9. **Percentage Parsing Edge Cases**
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementForm.tsx:160-173`  
**Evidence:**
```typescript
function parsePercentageToDecimal(value: string): number {
  if (!value || value.trim() === '') return 0
  const cleaned = value.replace(/%/g, '').trim()
  const num = parseFloat(cleaned)
  if (isNaN(num) || !isFinite(num) || num < 0) return 0
  return num / 100
}
```
**Edge Cases:**
- Input: "%" → cleaned = "" → 0 ✓
- Input: "5%" → 0.05 ✓
- Input: "5.5%" → 0.055 ✓
- Input: ".5%" → 0.005 ✓
- Input: "100%" → 1.0 ✓ (but causes division issues)
- Input: ">100%" → >1.0 (allowed, but unrealistic for investments)
- Input: "5.5.5%" → NaN → 0 (silent failure) ⚠️
- Input: "-5%" → -0.05 → filtered by num < 0 check ✓

**Issue:** Multiple decimal points silently return 0.

**Recommendation:** Add explicit validation for multiple decimal points, similar to currency parsing.

---

### 10. **Empty String vs Zero Handling**
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementForm.tsx:251-252`  
**Evidence:**
```typescript
const [monthlyIncomeInput, setMonthlyIncomeInput] = useState(defaultMonthlyIncome)
const [annualReturnRateInput, setAnnualReturnRateInput] = useState('6.0')
```
**Edge Case:** User clears the input (empty string)  
**Problem:** `parseCurrencyToCents("")` returns 0, `parsePercentageToDecimal("")` returns 0. Empty input is treated as 0, which triggers validation errors. However, the UX is confusing - user sees empty field but gets "Please enter a valid monthly income".

**Recommendation:** Distinguish between empty string (no input) and 0 (explicit zero). Show different messages or allow empty as valid (calculate nothing).

---

### 11. **State Update Race Condition in Timeline Chart**
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:668-671`  
**Evidence:**
```typescript
const handleRetirementAgeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  const value = parseInt(e.target.value, 10) || 0
  setRetirementAge(Math.max(value, currentAgeState + 1))
}, [currentAgeState])
```
**Edge Case:** User rapidly changes both currentAge and retirementAge  
**Problem:** The dependency on `currentAgeState` means if the user changes currentAge, then quickly changes retirementAge, the validation uses the OLD currentAgeState value from the closure.

**Project Context:** React hooks best practices

**Recommendation:** Use functional updates or combine the state into a single object to avoid stale closures.

---

### 12. **Chart Data Array Index Edge Case**
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:851-855`  
**Evidence:**
```typescript
your assets could grow to <strong>{formatChartCurrency(chartData[chartData.length - 1]?.endingBalance * 100, mode, currency)}</strong>
```
**Edge Case:** `chartData` is empty (projections returned empty array)  
**Problem:** The code already checks `if (chartData.length === 0)` and returns early (line 683-688), so this line should never execute with empty chartData. However, if that check is bypassed, `chartData[chartData.length - 1]` would be undefined.

**Recommendation:** Add null check: `chartData[chartData.length - 1]?.endingBalance` is good, but add a fallback value.

---

### 13. **Min/Max Age Validation Inconsistency**
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:707-727`  
**Evidence:** Inputs have min/max attributes but the change handlers use different logic  
**Edge Cases:**
- min attribute on currentAge input is 18, but handler uses `Math.max(value, 18)` ✓
- max attribute on currentAge input is 120, but handler doesn't enforce max ✗
- min attribute on retirementAge input is dynamic (`currentAgeState + 1`), but handler uses `Math.max(value, currentAgeState + 1)` ✓
- max attribute on retirementAge input is 120, but handler doesn't enforce max ✗

**Issue:** HTML5 validation (min/max) doesn't prevent typing values outside range, only prevents form submission. The JS handlers should enforce the same limits.

**Recommendation:** Add max validation in handlers to match HTML attributes.

---

### 14. **Currency Symbol Display Issue**
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementForm.tsx:363-364`  
**Evidence:**
```typescript
<span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
  {currency === 'USD' ? '$' : currency}
</span>
```
**Edge Cases:**
- Currency is 'NONE' (from CurrencyCode type) → displays "NONE" as symbol ⚠️
- Currency is 'EUR' → displays "EUR" instead of "€" ⚠️
- Currency is 'GBP' → displays "GBP" instead of "£" ⚠️

**Project Context:** Currency control system with mode toggle (project-context.md)

**Recommendation:** Use a proper currency symbol mapper or use Intl.NumberFormat to get the correct symbol.

---

### 15. **Missing Validation for Retirement Insights**
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementForm.tsx:258-274`  
**Evidence:**
```typescript
const retirementInsights = useMemo(() => {
  if (requiredAssets === null || totalInvestmentAssets === 0) {
    return null
  }
  const gap = requiredAssets - totalInvestmentAssets
  const gapPercentage = (gap / requiredAssets) * 100
  return {
    currentAssets: totalInvestmentAssets,
    gap: gap,
    gapPercentage: Math.round(gapPercentage),
    onTrack: gap <= 0,
    yearsToGoalAtCurrentRate: gap > 0 ? null : 0,
  }
}, [requiredAssets, totalInvestmentAssets])
```
**Edge Case:** `totalInvestmentAssets` is negative (user has debts classified as investments)  
**Problem:** The check `totalInvestmentAssets === 0` doesn't catch negative values. If user has negative investment assets, `gap` calculation will be wrong (requiredAssets - (-100000) = larger gap).

**Project Context:** Balance tracking can have negative values for debts

**Recommendation:** Check for `totalInvestmentAssets <= 0` or handle negative values appropriately.

---

### 16. **Floating Point Display Precision**
**Severity:** Low  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:634-636`  
**Edge Case:** Values like 123.456 cents become 1.23456 dollars, displayed as $1.23K or $1.23456M  
**Problem:** Floating point representation can cause display anomalies like $0.1 + $0.2 = $0.30000000000000004

**Project Context:** Financial calculations require precision

**Recommendation:** Round to 2 decimal places for display: `Math.round(value * 100) / 100`

---

## Summary

| Severity | Count | Notable Issues |
|----------|-------|----------------|
| Critical | 4 | Zero handling, division by zero, negative values, large numbers |
| High | 4 | Very large projections, age validation, currency formatting, empty input handling |
| Medium | 8 | Race conditions, chart edge cases, age validation, currency symbols, negative assets |
| Low | 1 | Floating point precision |

**Total Findings:** 17 edge case issues

**Recommendation:** Address all Critical and High severity edge cases before merging. Many of these relate to the project's explicit requirements in project-context.md for handling edge cases in financial calculations.

**Note:** Several findings overlap with Blind Hunter findings but are viewed through the lens of edge case analysis and project context.
