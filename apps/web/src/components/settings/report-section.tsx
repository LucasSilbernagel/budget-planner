/**
 * "Financial summary report" entry point on `/settings` (story 30-3, FR53).
 *
 * The report itself lives at `/report`; this is the discoverable way in. It is
 * wrapped in {@link PremiumFeatureGate} so a free visitor sees the feature
 * exists and is locked, rather than not seeing it at all — the same
 * surfaced-but-locked treatment the overview gives Advanced Forecasting and
 * Custom Profiles. The `/report` route gates independently, so this presentation
 * layer can never be the only thing standing between a free user and the report.
 *
 * ⚠️ Two shape constraints, both learned the hard way:
 *  - The gate is wrapped in its own <div>. In the locked state
 *    `PremiumFeatureGate` returns a fragment of the <button> PLUS a
 *    `PremiumPrompt` dialog as siblings, and `Modal` renders in normal flow with
 *    NO portal — so an unwrapped overlay inside a spaced stack picks up the
 *    parent's gap and leaves an undimmed strip across the top of the open
 *    dialog.
 *  - The locked content renders INSIDE a <button>, so it must contain no nested
 *    link or button. The unlocked branch is the <a>; the locked branch is inert
 *    text only.
 */

import type React from 'react'
import { PremiumFeatureGate } from '../premium'

/** The label shown in both tier states, so the section reads the same either way. */
function ReportFeatureLabel(): React.ReactElement {
  return (
    <span className="text-sm font-medium text-heading">
      Financial summary report
      <span className="mt-1 block text-sm font-normal text-muted">
        A printable summary of your budget, net worth and savings
      </span>
    </span>
  )
}

export function ReportSection(): React.ReactElement {
  return (
    <section
      aria-labelledby="settings-report-heading"
      className="mt-8 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
    >
      <h2
        id="settings-report-heading"
        className="text-lg font-semibold text-gray-900 dark:text-gray-100"
      >
        Financial summary
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Build a print-ready summary of the figures stored on this device and save it as a PDF
        through your browser's print dialog. The summary is assembled in your browser — nothing is
        sent anywhere to produce it.
      </p>
      {/* Own wrapper <div>: see the Modal/no-portal note in the file header. */}
      <div className="mt-3">
        <PremiumFeatureGate
          featureName="Financial Summary Report"
          className="border-default surface-interactive flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
          locked={<ReportFeatureLabel />}
        >
          <a
            href="/report"
            className="border-default surface-interactive flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left"
          >
            <ReportFeatureLabel />
            <span className="whitespace-nowrap text-sm font-medium text-accent">Open →</span>
          </a>
        </PremiumFeatureGate>
      </div>
    </section>
  )
}
