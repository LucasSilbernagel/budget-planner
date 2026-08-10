/**
 * `/categories` page shell — the Premium gate around category management
 * (story 30.4b, FR54).
 *
 * Three render states, copied from `ReportPage.tsx` (story 30.3), which itself
 * follows the `/profiles` precedent (story 13-3), so routes and feature gates
 * can never disagree about a user's tier:
 *   - `status.isLoading` (SSR + first client paint) → a neutral spinner. Never
 *     category content, so a not-yet-verified tier cannot leak paid output.
 *   - resolved `!hasAccess` (free / past_due / canceled / unauthenticated / an
 *     ERRORED check) → a full-page upgrade surface.
 *   - resolved `hasAccess` → the manager.
 *
 * Fail-closed by construction: only an explicitly resolved, entitled tier
 * reaches the manager. This is the presentation boundary, not a security one —
 * categories live in the user's own browser, so there is nothing here for a
 * bypass to exfiltrate.
 */

import type React from 'react'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { PremiumPrompt } from '../auth/premium-prompt'
import { CategoryBreakdown } from './CategoryBreakdown'
import { CategoryManager } from './CategoryManager'

export function CategoriesPage(): React.ReactElement {
  const { status } = usePremiumAccess()

  if (status.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div
          role="status"
          aria-label="Loading"
          className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
        />
      </div>
    )
  }

  if (!status.hasAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
        <PremiumPrompt
          featureName="Custom Categories"
          message="Create your own income and expense categories, assign them to your entries, and see your overview grouped the way you think about your money."
          asDialog={false}
        />
      </div>
    )
  }

  // ⚠️ ONE page shell for BOTH sections (story 30.5). The `min-h-screen` +
  // `mx-auto max-w-3xl` wrappers used to live inside `CategoryManager`; leaving
  // them there and stacking a second `min-h-screen` block would have put the
  // breakdown a full viewport below the fold. Each child is a SINGLE element,
  // so `space-y-8`'s `> * + *` rule can never margin the manager's fixed
  // ConfirmDialog overlay — see the comment in `CategoryManager`.
  return (
    <div className="min-h-screen surface-sunken p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <CategoryManager />
        <CategoryBreakdown />
      </div>
    </div>
  )
}
