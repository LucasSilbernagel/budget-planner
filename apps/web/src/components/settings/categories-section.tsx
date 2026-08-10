/**
 * "Categories" entry point on `/settings` (story 30.4b, FR54).
 *
 * Management itself lives at `/categories`; this is the discoverable way in.
 * Wrapped in {@link PremiumFeatureGate} so a free visitor sees the feature
 * exists and is locked rather than not seeing it at all (FR24) — the same
 * treatment `/report` gets. The `/categories` route gates independently, so this
 * presentation layer is never the only thing between a free user and the page.
 *
 * ⚠️ Two shape constraints, both inherited from `report-section.tsx`:
 *  - The gate is wrapped in its own <div>. In the locked state
 *    `PremiumFeatureGate` returns the <button> PLUS a `PremiumPrompt` dialog as
 *    siblings, and `Modal` renders in normal flow with NO portal — so an
 *    unwrapped overlay inside a spaced stack picks up the parent's gap and
 *    leaves an undimmed strip across the top of the open dialog.
 *  - The locked content renders INSIDE a <button>, so it must contain no nested
 *    link or button. The unlocked branch is the <a>; the locked branch is inert
 *    text only. And `aria-label` REPLACES the subtree, so the locked control's
 *    accessible name is only `Custom Categories — premium, locked`; the label
 *    text below contributes nothing to it.
 */

import type React from 'react'
import { PremiumFeatureGate } from '../premium'

/** The label shown in both tier states, so the section reads the same either way. */
function CategoriesFeatureLabel(): React.ReactElement {
  return (
    <span className="text-sm font-medium text-heading">
      Custom categories
      <span className="mt-1 block text-sm font-normal text-muted">
        Your own income and expense groupings
      </span>
    </span>
  )
}

export function CategoriesSection(): React.ReactElement {
  return (
    <section
      aria-labelledby="settings-categories-heading"
      className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
    >
      <h2
        id="settings-categories-heading"
        className="text-lg font-semibold text-gray-900 dark:text-gray-100"
      >
        Categories
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Create the categories you want to sort your income and expenses into, then pick one when you
        add or edit an entry. Renaming a category updates every entry that uses it.
      </p>
      {/* Own wrapper <div>: see the Modal/no-portal note in the file header. */}
      <div className="mt-3">
        <PremiumFeatureGate
          featureName="Custom Categories"
          className="border-default surface-interactive flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
          locked={<CategoriesFeatureLabel />}
        >
          <a
            href="/categories"
            className="border-default surface-interactive flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
          >
            <CategoriesFeatureLabel />
            <span className="whitespace-nowrap text-sm font-medium text-accent">Open →</span>
          </a>
        </PremiumFeatureGate>
      </div>
    </section>
  )
}
