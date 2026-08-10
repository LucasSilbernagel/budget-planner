/**
 * `/report` page shell — the Premium gate around the financial summary
 * (Story 30.3, FR53).
 *
 * Three render states, following the `/profiles` precedent (story 13-3) exactly
 * so routes and feature gates can never disagree about a user's tier:
 *   - `status.isLoading` (SSR + first client paint) → a neutral spinner. Never
 *     the report, so a not-yet-verified tier cannot leak paid content.
 *   - resolved `!hasAccess` (free / past_due / canceled / unauthenticated / an
 *     ERRORED check) → a full-page upgrade surface.
 *   - resolved `hasAccess` → the report.
 *
 * Fail-closed by construction: only an explicitly resolved, entitled tier
 * reaches the report. This is the presentation boundary; it is not a security
 * boundary, but unlike the premium features that call server functions, this one
 * has no server side to enforce — the report is assembled from data already in
 * the user's own browser, so there is nothing here for a bypass to exfiltrate.
 */

import type React from 'react'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { PremiumPrompt } from '../auth/premium-prompt'
import { FinancialSummaryReport } from './FinancialSummaryReport'

export function ReportPage(): React.ReactElement {
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
          featureName="Financial Summary Report"
          message="Produce a printable summary of your budget, net worth and savings, built entirely in your browser and saved as a PDF through your own print dialog."
          asDialog={false}
        />
      </div>
    )
  }

  return <FinancialSummaryReport />
}
