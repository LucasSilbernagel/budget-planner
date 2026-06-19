# Triage Report - Story 3-1 Code Review

**Date:** 2026-06-18  
**Story:** 3-1-implement-retirement-modeler-with-safe-withdrawal-model  
**Review Mode:** full  
**Layers Completed:** Blind Hunter, Edge Case Hunter, Acceptance Auditor  
**Failed Layers:** None

---

## Consolidated Findings

### 1. Potential XSS Vulnerability
- **ID:** 1
- **Source:** blind
- **Title:** Potential XSS in retirement insights display
- **Detail:** Template string interpolation with user-controlled values in retirementInsights display. `formatAmount` should properly escape output.
- **Location:** `apps/web/src/components/RetirementForm.tsx:463-467`
- **Classification:** patch
- **Severity:** High
- **Status:** Actionable

---

### 2. Missing Error Boundaries
- **ID:** 2
- **Source:** blind
- **Title:** No React Error Boundary wrapping components
- **Detail:** If any component throws during render (e.g., calculateCompoundingProjection), the entire app crashes with white screen.
- **Location:** All React components (RetirementPage, RetirementForm, RetirementTimelineChart)
- **Classification:** patch
- **Severity:** High
- **Status:** Actionable

---

### 3. Silent Error Swallowing
- **ID:** 3
- **Source:** blind
- **Title:** try-catch silently swallows projection errors
- **Detail:** If calculateCompoundingProjection throws, user sees "No data to display" with no explanation.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:613-623`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 4. Input Validation Returns Zero
- **ID:** 4
- **Source:** blind+edge
- **Title:** parsePercentageToDecimal and parseCurrencyToCents return 0 for invalid inputs
- **Detail:** Returns 0 for invalid inputs ("abc", "5.5.5%", etc.), which silently fails. User gets no error, just 0 result.  
- **Location:** `apps/web/src/components/RetirementForm.tsx:160-173, 180-204`
- **Classification:** patch
- **Severity:** High
- **Edge Case:** Multiple decimal points, non-numeric input
- **Status:** Actionable

---

### 5. Floating Point Precision Issues
- **ID:** 5
- **Source:** blind+edge
- **Title:** Floating point precision errors in cents-to-dollars conversion
- **Detail:** Converting cents to dollars by dividing by 100 can introduce floating point errors. For financial calculations, pennies could be off.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:634-636`
- **Classification:** patch
- **Severity:** High
- **Edge Case:** Any division by 100 operation
- **Status:** Actionable

---

### 6. Race Condition in State Initialization
- **ID:** 6
- **Source:** blind+edge
- **Title:** defaultMonthlyIncome memo updates but state doesn't sync
- **Detail:** If totalMonthlyIncome changes after initial render, defaultMonthlyIncome updates but monthlyIncomeInput state stays stale.
- **Location:** `apps/web/src/components/RetirementForm.tsx:211-251`
- **Classification:** patch
- **Severity:** High
- **Edge Case:** User adds new income source while form is open
- **Status:** Actionable

---

### 7. Negative Values Not Blocked
- **ID:** 7
- **Source:** edge
- **Title:** Negative values accepted in form inputs despite min="0"
- **Detail:** HTML5 min attribute doesn't prevent typing negative numbers. parseFloat accepts negative values.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:702-727`
- **Classification:** patch
- **Severity:** Critical
- **Edge Case:** User types negative principal or contribution
- **Status:** Actionable

---

### 8. Very Large Numbers Display Issues
- **ID:** 8
- **Source:** edge
- **Title:** Large currency values display poorly
- **Detail:** For values >= $1000M, format becomes `$1000.0M`. For extremely large numbers, display breaks entirely.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:525-533`
- **Classification:** patch
- **Severity:** High
- **Edge Case:** User enters $100M+ amounts
- **Status:** Actionable

---

### 9. Very Small Return Rates Cause Overflow
- **ID:** 9
- **Source:** edge
- **Title:** Tiny return rates cause enormous FV values
- **Detail:** With FV = Ir × (12 / r), very small r causes FV to be enormous. For r=0.001%, FV = Ir × 12,000,000.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:615-620`
- **Classification:** patch
- **Severity:** High
- **Edge Case:** User enters 0.001% return rate
- **Status:** Actionable

---

### 10. Very Long Projections (Performance)
- **ID:** 10
- **Source:** edge
- **Title:** 1000+ year projections will crash browser
- **Detail:** Chart tries to render 1000 data points, slow and potentially crashes. X-axis becomes unreadable.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:658-661`
- **Classification:** patch
- **Severity:** High
- **Edge Case:** User enters 1000 years
- **Performance Impact:** Client-side calculations must be optimized (project-context.md)
- **Status:** Actionable

---

### 11. Age Validation Incomplete
- **ID:** 11
- **Source:** edge
- **Title:** Age edge cases not fully validated
- **Detail:** Multiple issues: current age > retirement age possible, max age not enforced in JS, current age = retirement age allowed.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:663-671`
- **Classification:** patch
- **Severity:** High
- **Edge Case:** Various age combinations
- **Status:** Actionable

---

### 12. Division by Zero Still Possible
- **ID:** 12
- **Source:** blind+edge+auditor
- **Title:** Underlying calculateRequiredAssets throws on zero rate
- **Detail:** While UI validates, if annualReturnRate somehow becomes 0, the underlying function throws with different error message.
- **Location:** `packages/core/src/finance/retirement.ts:87-99` + UI integration
- **Classification:** patch
- **Severity:** Critical
- **Edge Case:** User enters exactly 0% return rate
- **AC Violation:** NFR3 (Zero tolerance for mathematical errors)
- **Status:** Actionable

---

### 13. Time-to-Retirement Not Implemented
- **ID:** 13
- **Source:** auditor
- **Title:** yearsToGoalAtCurrentRate calculation is stubbed
- **Detail:** Returns null or 0 with comment "Simplified - would need savings rate". Feature incomplete per spec.
- **Location:** `apps/web/src/components/RetirementForm.tsx:272`
- **Classification:** decision_needed
- **Severity:** Medium
- **Spec Issue:** Task 4, Subtask 3 marked complete but not implemented
- **Status:** Needs clarification

---

### 14. Missing Component Unit Tests
- **ID:** 14
- **Source:** auditor
- **Title:** No unit tests for new React components
- **Detail:** Unit tests exist for utility functions, but no tests for RetirementPage, RetirementForm, RetirementTimelineChart.
- **Location:** Testing Requirements section
- **Classification:** decision_needed
- **Severity:** Medium
- **Spec Issue:** Testing Requirements lists integration tests as pending
- **Status:** Needs clarification

---

### 15. File Path Mismatch in Spec
- **ID:** 15
- **Source:** auditor
- **Title:** Spec lists incorrect file paths
- **Detail:** Spec says `apps/web/app/routes/retirement.tsx` but actual is `apps/web/src/routes/retirement.tsx`. Similar for components.
- **Location:** File Modifications section (lines 130-133)
- **Classification:** patch
- **Severity:** Low
- **Status:** Actionable

---

### 16. Radix UI Not Used
- **ID:** 16
- **Source:** auditor
- **Title:** Spec requires Radix UI but implementation uses native HTML
- **Detail:** Task 2, Subtask 1 says "Use Radix UI components" but implementation uses native HTML with Tailwind.
- **Location:** Task 2 subtasks
- **Classification:** decision_needed
- **Severity:** Low
- **Status:** Needs clarification

---

### 17. Hardcoded Default Values
- **ID:** 17
- **Source:** blind+edge
- **Title:** Timeline chart has hardcoded defaults
- **Detail:** initialPrincipal=100000, annualReturnRate=0.06, etc. should be configurable or from user data.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:595-600`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 18. Missing Null Checks for Optional Props
- **ID:** 18
- **Source:** blind
- **Title:** Optional props not null-checked before use
- **Detail:** If props like principal, contribution are undefined, calculation will fail with NaN.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:615-620`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 19. No Loading States
- **ID:** 19
- **Source:** blind
- **Title:** No loading indicators for calculations
- **Detail:** Complex projections may have noticeable delay with no user feedback.
- **Location:** All components
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 20. Inconsistent Number Input Type
- **ID:** 20
- **Source:** edge
- **Title:** type="number" for currency causes issues
- **Detail:** type="number" has localization and decimal point issues. step="1000" limits increment.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:702-727`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 21. Currency Formatting Truncates Decimals
- **ID:** 21
- **Source:** edge
- **Title:** Three decimal digits silently truncated to two
- **Detail:** Input "123.456" becomes 12345 cents ($1.23) instead of 12346 cents ($1.23 rounded) or 123.456.
- **Location:** `apps/web/src/components/RetirementForm.tsx:198-201`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 22. Multiple Decimal Points in Percentage
- **ID:** 22
- **Source:** edge
- **Title:** Multiple decimal points in percentage silently return 0
- **Detail:** Input "5.5.5%" returns 0 with no error message.
- **Location:** `apps/web/src/components/RetirementForm.tsx:160-173`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 23. Empty String vs Zero Confusion
- **ID:** 23
- **Source:** edge
- **Title:** Empty input treated as 0, causing confusing UX
- **Detail:** User clears input, sees empty field, but gets "Please enter a valid monthly income" error.
- **Location:** `apps/web/src/components/RetirementForm.tsx:251-252`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 24. Race Condition in Age State Updates
- **ID:** 24
- **Source:** edge
- **Title:** Stale closure in retirement age change handler
- **Detail:** If user rapidly changes currentAge then retirementAge, validation uses OLD currentAgeState from closure.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:668-671`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 25. Max Age Not Enforced in JS
- **ID:** 25
- **Source:** edge
- **Title:** HTML5 max attribute not enforced in JavaScript
- **Detail:** Inputs have max="120" but JS handlers don't enforce this limit.
- **Location:** `apps/web/src/components/RetirementTimelineChart.tsx:707-727`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 26. Currency Symbol Display Issue
- **ID:** 26
- **Source:** edge
- **Title:** Currency symbol shows code instead of symbol
- **Detail:** For EUR shows "EUR" instead of "€", for GBP shows "GBP" instead of "£".
- **Location:** `apps/web/src/components/RetirementForm.tsx:363-364`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 27. Negative Investment Assets Not Handled
- **ID:** 27
- **Source:** edge
- **Title:** Negative investment assets cause wrong gap calculation
- **Detail:** Check is `totalInvestmentAssets === 0` but not `<= 0`. Negative values (debts) cause incorrect gap.
- **Location:** `apps/web/src/components/RetirementForm.tsx:260-262`
- **Classification:** patch
- **Severity:** Medium
- **Status:** Actionable

---

### 28. JSDoc Missing for Helper Functions
- **ID:** 28
- **Source:** auditor
- **Title:** formatInputCurrency and formatInputPercentage lack JSDoc
- **Detail:** Two helper functions missing documentation.
- **Location:** `apps/web/src/components/RetirementForm.tsx:224-247`
- **Classification:** patch
- **Severity:** Low
- **Status:** Actionable

---

### 29. Large Component Size
- **ID:** 29
- **Source:** blind
- **Title:** Components exceed typical size recommendations
- **Detail:** RetirementForm (349 lines) and RetirementTimelineChart (368 lines) are large.
- **Location:** Both component files
- **Classification:** defer
- **Severity:** Low
- **Status:** Pre-existing pattern in codebase

---

### 30. Inconsistent Task Completion in Spec
- **ID:** 30
- **Source:** auditor
- **Title:** Tasks marked complete but implementation doesn't match
- **Detail:** Radix UI subtask marked complete but not used.
- **Location:** Tasks/Subtasks section
- **Classification:** patch
- **Severity:** Low
- **Status:** Actionable

---

## Triage Summary

### Classification Counts

| Classification | Count | Notes |
|--------------|-------|-------|
| **patch** | 24 | Code issues fixable without human input |
| **decision_needed** | 3 | Requires human input on intent |
| **defer** | 1 | Pre-existing issue |
| **dismiss** | 0 | No false positives |

### Severity Distribution

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 10 |
| Medium | 14 |
| Low | 3 |

### Actionable Items

**Must Fix Before Merge (Critical + High):** 13 issues  
**Should Fix Before Merge (Medium):** 14 issues  
**Nice to Fix (Low):** 3 issues  
**Needs Discussion (decision_needed):** 3 issues

---

## Decision Items (Requires Your Input)

### Decision 1: Time-to-Retirement Calculation (ID: 13)
**Question:** Should we implement the full time-to-retirement calculation based on savings rate, or is the simplified version (just showing gap) acceptable?

**Options:**
- [A] Implement full calculation using savings rate from existing data
- [B] Keep simplified version and update spec to remove this subtask
- [C] Defer to a follow-up story

### Decision 2: Missing Component Tests (ID: 14)
**Question:** The Testing Requirements list integration tests as pending. Should we add these before merging?

**Options:**
- [A] Add integration tests for all new components now
- [B] Update Testing Requirements to accurately reflect current state
- [C] Defer tests to follow-up

### Decision 3: Radix UI vs Native HTML (ID: 16)
**Question:** Spec requires Radix UI but implementation uses native HTML with Tailwind. Which should we use?

**Options:**
- [A] Update implementation to use Radix UI components
- [B] Update spec to allow native HTML with Tailwind
- [C] Defer consistency decision to later

---

## Recommended Fixes (Patch Classification)

All 24 patch items can be fixed without human input. Key fixes include:

1. **Critical Security:** Add XSS protection, error boundaries
2. **Input Validation:** Proper error handling for invalid inputs
3. **Edge Cases:** Handle zero, negative, very large/small values
4. **Performance:** Limit projection years to reasonable max
5. **Consistency:** Fix currency formatting, age validation
6. **Documentation:** Add missing JSDoc, update spec file paths

---

## Next Steps

1. **You must decide** on the 3 decision_needed items above
2. **Address patch items** - 24 fixable issues, prioritize by severity
3. **Re-run review** after fixes to verify clean result

**Status:** Review complete with findings. Not clean - requires fixes and decisions.
