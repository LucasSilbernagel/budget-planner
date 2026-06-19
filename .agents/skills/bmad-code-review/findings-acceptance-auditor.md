# Acceptance Auditor Findings - Story 3-1

**Role:** Acceptance Auditor with diff + spec + context docs  
**Date:** 2026-06-18  
**Spec File:** `3-1-implement-retirement-modeler-with-safe-withdrawal-model.md`  
**Context Docs:** `project-context.md`  
**Diff:** +850 lines across 4 files

---

## Acceptance Criteria Compliance

### AC-1: Safe Withdrawal Formula Implementation ✅

**Spec Requirement:**
> **Given** I enter desired retirement income (Ir) and rate of return (r)  
> **When** I request the retirement calculation  
> **Then** the system calculates FV = Ir × (12 / r)  
> **And** displays the required future value of assets

**Implementation Review:**
- ✅ Formula correctly implemented in `calculateRequiredAssets` function (existing file)
- ✅ Function signature: `calculateRequiredAssets(monthlyIncome: number, annualReturnRate: number): number`
- ✅ Used in RetirementForm component (line 300)
- ✅ Displayed to user in RetirementForm (line 428-433)

**Verdict:** **PASS** - AC-1 is fully implemented

---

### AC-2: Specific Calculation Validation ✅

**Spec Requirement:**
> **Given** I want $5000/month retirement income with 6% annual return (0.06)  
> **When** I request the calculation  
> **Then** FV = 5000 × (12 / 0.06) = 5000 × 200 = $1,000,000  
> **And** the system displays that I need $1,000,000 in assets

**Implementation Review:**
- ✅ Formula verified: 5000 × (12 / 0.06) = 5000 × 200 = 1,000,000
- ✅ Test exists in `retirement.test.ts` (line 28-41) with cents: 500000 cents → 100000000 cents = $1,000,000
- ✅ Verified manually with Node.js test script
- ✅ Display logic in RetirementForm shows formatted result

**Note:** The implementation uses cents internally (500000 for $5000), but the mathematical result is correct when converted back to dollars.

**Verdict:** **PASS** - AC-2 is fully implemented and validated

---

### AC-3: Age Timeline Mapping ✅

**Spec Requirement:**
> **Given** I provide current age and life expectancy  
> **When** I request the retirement calculation  
> **Then** the system maps asset growth timelines against my age  
> **And** displays compounding projections

**Implementation Review:**
- ✅ RetirementTimelineChart component created with age-based projections
- ✅ Maps current age to retirement age (lines 627-639)
- ✅ Displays compounding projections using Recharts (lines 807-844)
- ✅ Uses `calculateCompoundingProjection` from core package (line 615-620)
- ✅ Compounding formula implemented in existing retirement.ts file

**Verdict:** **PASS** - AC-3 is fully implemented

---

## Spec Deviation Findings

### 1. **File Path Mismatch**
**Severity:** Medium  
**Spec Location:** File Modifications section (lines 130-133)  
**Evidence:**
```markdown
**NEW Files:**
- `packages/core/src/finance/retirement.ts` - Retirement calculation utilities
- `apps/web/app/routes/retirement.tsx` - Retirement calculator page
- `apps/web/app/components/retirement/retirement-form.tsx` - Form component
- `apps/web/app/components/retirement/timeline-chart.tsx` - Timeline visualization
```
**Actual Implementation:**
- `packages/core/src/finance/retirement.ts` ✅
- `apps/web/src/routes/retirement.tsx` (not `app/routes/`) ✅
- `apps/web/src/components/RetirementForm.tsx` (not `app/components/retirement/retirement-form.tsx`) ⚠️
- `apps/web/src/components/RetirementTimelineChart.tsx` (not `app/components/retirement/timeline-chart.tsx`) ⚠️

**Issue:** The spec file lists incorrect paths. The actual project structure uses `src/` not `app/`, and uses PascalCase for component filenames.

**Impact:** Minor - files are in the correct logical location, just path notation differs

**Recommendation:** Update spec file to match actual project structure.

---

### 2. **Radix UI Not Used**
**Severity:** Low  
**Spec Location:** Task 2, Subtask 1 (line 69)  
**Evidence:**
```markdown
- [x] Use Radix UI components for accessible form
```
**Actual Implementation:** Uses native HTML inputs with Tailwind CSS styling

**Issue:** The subtask mentions Radix UI, but the implementation uses standard HTML form elements. This is marked as complete but doesn't match the spec.

**Project Context:** project-context.md lists "Radix UI Primitives" as the component library

**Impact:** Low - Native HTML with proper accessibility attributes is acceptable, but doesn't match the explicit requirement.

**Recommendation:** Either update the implementation to use Radix UI components, or update the spec to reflect that native HTML is acceptable.

---

### 3. **Inconsistent Task Completion**
**Severity:** Low  
**Spec Location:** Tasks/Subtasks section  
**Evidence:** All tasks marked as [x] complete, but some subtasks reference Radix UI which wasn't used

**Issue:** Task 2 subtask "Use Radix UI components for accessible form" is marked complete but Radix UI wasn't used.

**Impact:** Documentation inconsistency

**Recommendation:** Update subtasks to match actual implementation (use "Native HTML with Tailwind CSS" instead of "Radix UI")

---

## Missing Implementation

### 4. **Task 4 - Time-to-Retirement Calculation**
**Severity:** Medium  
**Spec Location:** Task 4, Subtask 3 (line 95)  
**Evidence:**
```markdown
- [x] Calculate time-to-retirement based on current savings rate
```
**Actual Implementation:** 
```typescript
yearsToGoalAtCurrentRate: gap > 0 ? null : 0, // Simplified - would need savings rate
```
**Issue:** The implementation returns `null` for positive gaps and `0` for negative gaps, with a comment indicating it's simplified. The actual time-to-retirement calculation based on savings rate is not implemented.

**Impact:** Feature incomplete per spec

**Recommendation:** Implement the time-to-retirement calculation using the user's savings rate from their existing financial data, or remove this subtask if it's out of scope.

---

## Architectural Violations

### 5. **Currency Handling Inconsistency**
**Severity:** Medium  
**Spec Location:** Developer Context → Dependencies (line 108)  
**Evidence:**
```markdown
- **Formula:** FV = Ir × (12 / r) where FV = Future Value, Ir = desired retirement income, r = rate of return
```
**Actual Implementation:**
- Formula uses cents internally (Ir and FV in cents)
- UI displays in dollars
- Conversion happens at the boundaries

**Project Context:** project-context.md: "All financial math must pass validation tests" (NFR3)

**Issue:** The spec doesn't specify whether inputs should be in dollars or cents. The implementation uses cents, which is consistent with the existing codebase (balance tracking, etc.), but this should be documented.

**Verdict:** **NOT A VIOLATION** - Implementation is consistent with project patterns, but documentation should clarify the currency unit convention.

---

### 6. **Missing Unit Tests for New Components**
**Severity:** Medium  
**Spec Location:** Testing Requirements (lines 142-147)  
**Evidence:**
```markdown
- [x] Unit tests for `calculateRequiredAssets` function (Vitest)
- [x] Test with known values: Ir=$5000, r=0.06 → FV=$1,000,000
- [x] Test edge cases: zero, negative, very large values
- [ ] Integration tests for UI component
- [ ] Accessibility tests (eslint-plugin-jsx-a11y)
- [x] Biome linting passes with zero violations
```
**Actual Implementation:**
- Unit tests exist for utility functions ✅
- No tests for React components ❌

**Issue:** Testing Requirements section indicates Integration tests and Accessibility tests are pending, but these are listed as requirements, not optional.

**Project Context:** project-context.md: "All financial calculations must have mathematical validation tests" (Testing Strategy)

**Impact:** Incomplete test coverage per spec

**Recommendation:** Add integration tests for the new React components, or update the Testing Requirements to accurately reflect what's been implemented.

---

## Documentation Issues

### 7. **Inconsistent File List in Story**
**Severity:** Low  
**Spec Location:** File Modifications section (lines 129-136)  
**Evidence:** Lists files that don't match actual implementation paths

**Issue:** Documentation outdated

**Recommendation:** Update File List section to match actual file paths created.

---

### 8. **JSDoc Missing for Some Functions**
**Severity:** Low  
**Spec Location:** Developer Context → Architecture Requirements (line 104)  
**Evidence:**
```markdown
- **Testing:** Unit tests with Vitest for mathematical validation (NFR3)
- **No hardcoded values:** All formulas must be configurable and documented
```
**Actual Implementation:**
- `parsePercentageToDecimal` - has JSDoc ✅
- `parseCurrencyToCents` - has JSDoc ✅
- `formatInputCurrency` - no JSDoc ❌
- `formatInputPercentage` - no JSDoc ❌

**Issue:** Not all helper functions have JSDoc documentation

**Impact:** Minor violation of documentation requirements

**Recommendation:** Add JSDoc comments to all helper functions.

---

## Summary

### Acceptance Criteria Status

| AC | Status | Notes |
|----|--------|-------|
| AC-1 | ✅ PASS | Formula correctly implemented and used |
| AC-2 | ✅ PASS | Specific calculation validated |
| AC-3 | ✅ PASS | Age timeline mapping implemented |

**All Acceptance Criteria: PASS**

### Spec Compliance Issues

| Issue | Severity | Status |
|-------|----------|--------|
| File path mismatch in spec | Low | Documentation issue |
| Radix UI not used | Low | Spec vs implementation mismatch |
| Time-to-retirement not fully implemented | Medium | Partial implementation |
| Missing component unit tests | Medium | Incomplete test coverage |
| Documentation inconsistencies | Low | Minor violations |

**Total Findings:** 8 spec compliance issues (3 Medium, 5 Low)

### Recommendations

1. **Before Merging:**
   - Address the time-to-retirement calculation (Task 4, Subtask 3)
   - Add integration tests for UI components
   - Add missing JSDoc comments

2. **Documentation Updates:**
   - Update File List in spec to match actual paths
   - Update subtasks to reflect actual implementation (Radix UI → Native HTML)
   - Clarify currency unit convention (cents vs dollars)

3. **Optional Improvements:**
   - Consider using Radix UI components for consistency with project patterns
   - Add more comprehensive test coverage

**Overall Assessment:** All acceptance criteria are met, but there are documentation and test coverage gaps that should be addressed before considering the story complete.
