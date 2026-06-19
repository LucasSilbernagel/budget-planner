# Blind Hunter Findings - Story 3-1

**Role:** Adversarial reviewer with NO project context - diff only  
**Date:** 2026-06-18  
**Diff:** +850 lines across 4 files (3 new, 1 modified)

---

## Critical Issues

### 1. Potential XSS Vulnerability in RetirementForm
**Severity:** High  
**Location:** `apps/web/src/components/RetirementForm.tsx:463-467`  
**Evidence:**
```typescript
<span className={`font-medium ${retirementInsights.gap >= 0 ? 'text-red-600' : 'text-green-600'}`}>
  {retirementInsights.gap >= 0 
    ? formatAmount(retirementInsights.gap) 
    : `✓ Goal achieved!`}
</span>
```
**Issue:** Template string interpolation with user-controlled values could allow injection if `formatAmount` doesn't properly escape. While unlikely in this case, the pattern is risky.

**Recommendation:** Ensure `formatAmount` properly escapes all output, or use a safer rendering method.

---

### 2. Missing Error Boundaries
**Severity:** High  
**Location:** All React components (RetirementPage, RetirementForm, RetirementTimelineChart)  
**Evidence:** No error boundary components wrapping the tree  
**Issue:** If any component throws during render (e.g., from `calculateCompoundingProjection` throwing), the entire app will crash with a white screen.  
**Recommendation:** Wrap components with React Error Boundary, especially around mathematical calculations.

---

### 3. Unhandled Promise in calculateCompoundingProjection
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:613-623`  
**Evidence:**
```typescript
const projections = useMemo(() => {
  try {
    return calculateCompoundingProjection({
      principal: principal * 100,
      annualContribution: contribution * 100,
      annualReturnRate: returnRate / 100,
      years,
    })
  } catch (e) {
    return []
  }
}, [principal, contribution, returnRate, years])
```
**Issue:** The try-catch silently swallows errors. If `calculateCompoundingProjection` throws, the user sees "No data to display" with no explanation of why.

**Recommendation:** Log the error or display a user-friendly error message.

---

## High Severity Issues

### 4. No Input Sanitization for Number Parsing
**Severity:** High  
**Location:** `apps/web/src/components/RetirementForm.tsx:160-173, 180-204`  
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
**Issue:** Returns 0 for invalid inputs, which silently fails. User enters "abc" and gets no error, just 0 result. This could mask data entry errors.

**Recommendation:** Return `null` or throw for invalid inputs, and validate before calculation.

---

### 5. Floating Point Precision Issues
**Severity:** High  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:634-636`  
**Evidence:**
```typescript
startingBalance: projection.startingBalance / 100,
endingBalance: projection.endingBalance / 100,
annualContribution: projection.annualContribution / 100,
```
**Issue:** Converting cents to dollars by dividing by 100 can introduce floating point precision errors. For financial calculations, this could lead to pennies being off.

**Recommendation:** Use BigInt or a decimal library for financial precision, or round to 2 decimal places.

---

### 6. Race Condition in State Updates
**Severity:** High  
**Location:** `apps/web/src/components/RetirementForm.tsx:211-248`  
**Evidence:**
```typescript
const defaultMonthlyIncome = useMemo(() => {
  if (preFillFromExistingData && totalMonthlyIncome > 0) {
    return (totalMonthlyIncome * 0.5).toFixed(0)
  }
  return ''
}, [preFillFromExistingData, totalMonthlyIncome])

// Form state
const [monthlyIncomeInput, setMonthlyIncomeInput] = useState(defaultMonthlyIncome)
```
**Issue:** If `totalMonthlyIncome` changes after initial render (e.g., user adds new income source), the `defaultMonthlyIncome` memo updates but the state doesn't reset. User could be working with stale pre-filled values.

**Recommendation:** Use useEffect to sync state when dependencies change, or make pre-fill a one-time operation.

---

## Medium Severity Issues

### 7. Hardcoded Default Values
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:595-600`  
**Evidence:**
```typescript
initialPrincipal = 100000,
annualContribution = 0,
annualReturnRate = 0.06,
yearsToProject = 30,
retirementAge = 65,
currentAge = 35,
```
**Issue:** Hardcoded defaults may not be appropriate for all users. These should ideally come from user preferences or be configurable.

**Recommendation:** Move defaults to configuration or derive from user data.

---

### 8. Missing Null Checks for Optional Props
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:615-620`  
**Evidence:**
```typescript
return calculateCompoundingProjection({
  principal: principal * 100,
  annualContribution: contribution * 100,
  annualReturnRate: returnRate / 100,
  years,
})
```
**Issue:** If any of these values are undefined (props are optional), the calculation will fail with NaN.

**Recommendation:** Add null checks or provide default values at the prop level.

---

### 9. Potential Division by Zero
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementForm.tsx:299-300`  
**Evidence:**
```typescript
const result = calculateRequiredAssets(monthlyIncomeCents, annualReturnRate)
```
**Issue:** While `parsePercentageToDecimal` returns 0 for invalid inputs and there's validation, if `annualReturnRate` somehow becomes 0, the underlying `calculateRequiredAssets` will throw. The validation checks for 0 but the error message could be clearer.

**Recommendation:** Explicitly check for division by zero in the formula function.

---

### 10. No Loading States
**Severity:** Medium  
**Location:** All components  
**Evidence:** No loading indicators for calculations  
**Issue:** For complex projections with many years, there could be a noticeable delay with no feedback to the user.

**Recommendation:** Add loading states for calculations, especially for the timeline chart with many data points.

---

### 11. Inconsistent Number Handling
**Severity:** Medium  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:702-727`  
**Evidence:**
```typescript
<input
  type="number"
  id="principal"
  value={principal}
  onChange={handlePrincipalChange}
  className="..."
  min="0"
  step="1000"
/>
```
**Issue:** Using `type="number"` for currency inputs can cause issues with decimal points and localization. Also, `step="1000"` means users can only increment by 1000.

**Recommendation:** Use `type="text"` with proper input masking for currency, or remove step attribute for free entry.

---

## Low Severity Issues

### 12. Magic Numbers
**Severity:** Low  
**Location:** Multiple files  
**Evidence:** Values like `100` (cents conversion), `0.5` (50% pre-fill), `18` (min age), `120` (max age) appear without explanation.  
**Issue:** Makes code harder to maintain and understand.  
**Recommendation:** Extract to named constants with comments.

---

### 13. Duplicate Code
**Severity:** Low  
**Location:** `apps/web/src/components/RetirementForm.tsx:205-219, 224-247`  
**Evidence:** Two format helper functions (`formatInputCurrency`, `formatInputPercentage`) have similar cleaning logic.  
**Issue:** Violates DRY principle.  
**Recommendation:** Extract common cleaning logic to a shared utility function.

---

### 14. Commented Code
**Severity:** Low  
**Location:** `apps/web/src/components/RetirementTimelineChart.tsx:272`  
**Evidence:**
```typescript
yearsToGoalAtCurrentRate: gap > 0 ? null : 0, // Simplified - would need savings rate
```
**Issue:** Comment indicates incomplete implementation.  
**Recommendation:** Either implement fully or remove the field from the return type.

---

### 15. No Prop Types for All Props
**Severity:** Low  
**Location:** `apps/web/src/routes/retirement.tsx`  
**Evidence:** RetirementPage component has no defined props interface.  
**Issue:** Missing type safety for component props.  
**Recommendation:** Add interface for component props even if currently empty.

---

## Code Smells

### 16. Overuse of Inline Functions in JSX
**Severity:** Low  
**Location:** All components  
**Evidence:** Many arrow functions created in render/return statements.  
**Issue:** Creates new function instances on every render, can impact performance.  
**Recommendation:** Move to useCallback or define outside component where appropriate.

---

### 17. Large Component Size
**Severity:** Low  
**Location:** `apps/web/src/components/RetirementForm.tsx` (349 lines), `RetirementTimelineChart.tsx` (368 lines)  
**Evidence:** Components exceed typical size recommendations.  
**Issue:** Harder to maintain and test.  
**Recommendation:** Consider breaking into smaller sub-components (e.g., extract input fields, result display).

---

## Summary

| Severity | Count | Notable Issues |
|----------|-------|----------------|
| Critical | 3 | XSS risk, missing error boundaries, silent error swallowing |
| High | 4 | Input sanitization, floating point precision, race conditions, hardcoded defaults |
| Medium | 5 | Missing null checks, potential division by zero, no loading states, inconsistent number handling |
| Low | 5 | Magic numbers, duplicate code, commented code, missing prop types, large components |

**Total Findings:** 17 issues across 4 severity levels

**Recommendation:** Address Critical and High severity issues before merging. Medium and Low can be addressed in follow-up PRs.
