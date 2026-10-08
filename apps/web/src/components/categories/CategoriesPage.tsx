import type React from 'react'
import { usePremiumAccess } from '../../hooks/usePremiumAccess'
import { PremiumPrompt } from '../auth/premium-prompt'
import { CategoryBreakdown } from './CategoryBreakdown'
import { CategoryManager } from './CategoryManager'

export function CategoriesPage(): React.ReactElement {
  const { status } = usePremiumAccess()

  if (status.isLoading) {
    // Distinct keys make React replace the loading subtree rather than grow it (layout shift).
    return (
      <main
        key="premium-loading"
        className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900"
      >
        <div
          role="status"
          aria-label="Loading"
          className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
        />
      </main>
    )
  }

  if (!status.hasAccess) {
    return (
      <main
        key="premium-locked"
        className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900"
      >
        <PremiumPrompt
          featureName="Custom Categories"
          message="Create your own income and expense categories, assign them to your entries, and see your overview grouped the way you think about your money."
          asDialog={false}
        />
      </main>
    )
  }

  // Each child must stay a single element, or space-y margins the manager's fixed dialog overlay.
  return (
    <div key="premium-content" className="min-h-screen surface-sunken p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <CategoryManager />
        <CategoryBreakdown />
      </div>
    </div>
  )
}
