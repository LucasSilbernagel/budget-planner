---
baseline_commit: 702378a
---

# Story 2.3: Implement balance tracking CRUD operations

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to create, read, update, and delete balance tracking entries for investments and debts,
So that I can monitor my investment and debt balances.

## Acceptance Criteria

**Create Balance Entry:**
1. **Given** I am on the balance tracking page
   **When** I click "Add Balance Entry"
   **Then** I can enter type (investment/debt), name, current balance, max contribution limit, and monthly contribution
   **And** I can save the entry
   **And** it appears in my balance tracking list

**Read Balance Entries:**
2. **Given** I have balance tracking entries
   **When** I view the balance tracking list
   **Then** all my entries are displayed with type, name, current balance, and growth projection
   **And** entries are grouped by type (investments vs debts)

**Update Balance Entry:**
3. **Given** a balance entry exists
   **When** I click edit on that entry
   **Then** I can modify its type, name, current balance, max contribution limit, or monthly contribution
   **And** the changes are saved
   **And** the updated entry appears in the list with new values

**Delete Balance Entry:**
4. **Given** a balance entry exists
   **When** I click delete on that entry
   **Then** it is removed from my list
   **And** it cannot be recovered

**Type Display:**
5. **Given** I have balance entries of different types
   **When** I view the balance tracking list
   **Then** investment entries are displayed with positive growth indicators
   **And** debt entries are displayed with negative balance indicators

**Contribution Tracking:**
6. **Given** a balance entry with maxContributionLimit = $5000 and monthlyContribution = $500
   **When** I view the entry
   **Then** I see that it will reach the limit in 10 months at current rate

## Tasks / Subtasks

- [x] Create TypeScript interfaces for BalanceTracking
  - [x] Define BalanceTracking interface with all required fields
  - [x] Extend financeTypeEnum usage for type field
- [x] Create API service layer for balance tracking
  - [x] Implement GET /balance-tracking endpoint
  - [x] Implement POST /balance-tracking endpoint
  - [x] Implement PUT /balance-tracking/:id endpoint
  - [x] Implement DELETE /balance-tracking/:id endpoint
- [x] Create React components for balance tracking
  - [x] BalanceTrackingList component
  - [x] BalanceEntryCard component
  - [x] AddBalanceEntryForm component
  - [x] EditBalanceEntryForm component
- [x] Implement client-side data persistence (free tier)
  - [x] Use localStorage for storing balance entries
  - [x] Implement CRUD operations using IndexedDB
  - [x] Add data validation before persistence
- [x] Add contribution timeline calculation
  - [x] Calculate months to max contribution limit
  - [x] Handle cases where no limit is set
  - [x] Format timeline for display
- [x] Create balance tracking page with routing
  - [x] Add route for /balance-tracking
  - [x] Integrate with TanStack Start file-based routing
  - [x] Add navigation to balance tracking page
- [x] Add type-specific display logic
  - [x] Style investment entries with success/green theme
  - [x] Style debt entries with danger/red theme
  - [x] Add appropriate icons for each type
- [x] Add error handling and user feedback
  - [x] Display success/error messages
  - [x] Add loading states
  - [x] Validate form inputs
- [x] Add accessibility compliance
  - [x] Ensure all form controls have proper labels
  - [x] Add ARIA attributes for screen readers
  - [x] Verify keyboard navigation works

## Dev Notes

### Architecture Compliance

**Frontend Layer:**
- **Framework:** TanStack Start with React 19
- **Components:** Radix UI Primitives
- **Styling:** Tailwind CSS (utility-first)
- **State Management:** Zustand for transient UI state
- **Routing:** File-based routing in apps/web/src/routes/

**Backend Layer (for paid tier):**
- **Server Functions:** TanStack Start Server Functions
- **Service Layer:** Lightweight TypeScript service
- **Database:** Scaleway PostgreSQL via Drizzle ORM

**Free Tier:**
- Client-side only using localStorage and IndexedDB
- No server communication
- No authentication required

### Source Tree Components to Touch

**Primary Files:**
- `packages/db/schema.ts` - Use balanceTracking table (from Story 2.1)
- `apps/web/src/routes/balance-tracking.tsx` - New route for balance tracking page
- `apps/web/src/components/BalanceTrackingList.tsx` - New component
- `apps/web/src/components/BalanceEntryCard.tsx` - New component
- `apps/web/src/components/AddBalanceEntryForm.tsx` - New component
- `apps/web/src/components/EditBalanceEntryForm.tsx` - New component

**Service Files:**
- `apps/web/src/server/functions/balanceTracking.ts` - Server functions (paid tier)
- `packages/core/src/services/balanceTracking.ts` - Core service layer

**Store Files:**
- `apps/web/src/stores/balanceStore.ts` - Zustand store for client-side state

**Utility Files:**
- `packages/core/src/utils/balanceCalculations.ts` - Contribution timeline utilities

**Existing Files to Reference:**
- `apps/web/src/components/ExpenseList.tsx` - For component pattern reference (from Epic 1)
- `apps/web/src/stores/incomeStore.ts` - For store pattern reference (from Epic 1)
- `packages/db/schema.ts` - For BalanceTracking type reference

### Technical Requirements

**Data Structure:**
```typescript
interface BalanceTracking {
  id: string;
  userId?: string; // Only for paid tier
  type: 'investment' | 'debt'; // From financeTypeEnum
  name: string;
  currentBalance: number; // In cents (can be negative for debts)
  maxContributionLimit?: number; // In cents, optional
  monthlyContribution?: number; // In cents, optional
  createdAt: string;
  updatedAt: string;
}
```

**Timeline Calculation:**
```typescript
function calculateMonthsToLimit(
  currentBalance: number,
  maxContributionLimit: number | undefined,
  monthlyContribution: number | undefined
): number | null {
  if (!maxContributionLimit || !monthlyContribution || monthlyContribution <= 0) {
    return null;
  }
  const remaining = maxContributionLimit - currentBalance;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / monthlyContribution);
}
```

**Form Validation:**
- name: Required, max 100 characters
- type: Required, must be 'investment' or 'debt'
- currentBalance: Required, integer (in cents, can be negative)
- maxContributionLimit: Optional, non-negative integer (in cents)
- monthlyContribution: Optional, non-negative integer (in cents)

**Storage Keys:**
- localStorage: `budget-planner:balance-tracking`
- IndexedDB: `balanceTracking` store

### Testing Standards

**Unit Tests:**
- Test timeline calculation with various inputs
- Test form validation logic
- Test data persistence (localStorage/IndexedDB)

**Component Tests:**
- Test BalanceEntryCard rendering for both types
- Test form submission and validation
- Test list grouping by type

**Integration Tests:**
- Test full CRUD flow
- Test data persistence across page refresh

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-2-Extended-Financial-Management--Basic-Insights]
- [Source: _bmad-output/planning-artifacts/epics.md#Story-2.3-Implement-balance-tracking-CRUD-operations]
- [Source: _bmad-output/planning-artifacts/architecture.md#Technical-Stack]
- [Source: _bmad-output/project-context.md#Technology-Stack--Versions]
- [Source: _bmad-output/project-context.md#Critical-Implementation-Rules]

### Dependencies

**Blocked By:** Story 2.1 (balanceTracking table must exist)
**Blocks:** Story 2.5, Story 2.6, Story 2.7 (calculations depend on balance data)

### Previous Story Intelligence (from Story 2.1 and 2.2)

- Drizzle schema patterns established
- CRUD operation patterns from Story 2.2 (savings goals)
- uuid primary keys used throughout
- Monetary values stored in cents as integers
- Progress calculation utilities pattern established

## Dev Agent Record

### Agent Model Used

Mistral Vibe (mistral-medium-3.5)

### Debug Log References

- Review Story 1.5 for CRUD operation patterns (expense CRUD)
- Check Story 2.2 for savings goal CRUD patterns
- Verify financeTypeEnum usage from Story 2.1

### Completion Notes List

- Implemented full CRUD operations for balance tracking entries (investments and debts)
- All acceptance criteria satisfied: create, read, update, delete, type display, and contribution tracking
- Used negative IDs for client-side storage to align with Story 2-2 pattern
- Reused FinanceType enum ('investment' | 'debt') from database schema
- All monetary values in cents (integers) to avoid floating-point precision issues
- Dynamic currency formatting using useCurrencyPreferences() + formatCurrency from core package
- Implemented contribution timeline calculation: months to limit = ceil((limit - current) / monthlyContribution)

### File List

- [NEW] `apps/web/src/routes/balance-tracking.tsx` - Balance tracking page with routing, stats display, list integration, and modals
- [NEW] `apps/web/src/components/BalanceTrackingList.tsx` - List component grouped by type (investments vs debts)
- [NEW] `apps/web/src/components/BalanceEntryCard.tsx` - Individual entry card with type-specific styling and timeline display
- [NEW] `apps/web/src/components/AddBalanceEntryForm.tsx` - Add form with validation and currency formatting
- [NEW] `apps/web/src/components/EditBalanceEntryForm.tsx` - Edit form with pre-filled data and validation
- [NEW] `packages/core/src/services/balanceTracking.ts` - Core service layer with interfaces, validation, sorting, and filtering
- [NEW] `packages/core/src/utils/balanceCalculations.ts` - Timeline and progress calculation utilities
- [NEW] `packages/core/src/services/__tests__/balanceTracking.test.ts` - Service unit tests
- [NEW] `packages/core/src/utils/__tests__/balanceCalculations.test.ts` - Calculation unit tests
- [NEW] `apps/web/src/server/functions/balanceTracking.ts` - Server functions for paid tier
- [MODIFIED] `apps/web/src/stores/balanceStore.ts` - Zustand store with selectors and actions (updated)

### Change Log

- 2026-06-18: Implemented full CRUD operations for balance tracking
- 2026-06-18: Added client-side persistence for free tier (localStorage and IndexedDB)
- 2026-06-18: Created timeline calculation utilities for contribution tracking
- 2026-06-18: Added React components for balance tracking UI
- 2026-06-18: Added type-specific styling (green for investments, red for debts)
- 2026-06-18: Added server functions for paid tier implementation
