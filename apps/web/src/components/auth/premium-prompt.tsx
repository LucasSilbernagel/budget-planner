import { Link } from '@tanstack/react-router'
import React from 'react'
import { PREMIUM_BENEFIT_IDS, type PremiumBenefitId } from '../../lib/premium/benefits'
import { Modal } from '../ui/Modal'

export interface PremiumPromptProps {
  featureName?: string
  message?: string
  asDialog?: boolean
  upgradeHref?: string
  onUpgradeClick?: () => void
  onClose?: () => void
}

/**
 * Terse names: the list must fit a 320×480 dialog. "Downloadable" on the report is a
 * decided exception to one-name-per-feature, for this card only; don't spread or revert it.
 */
export const PREMIUM_FEATURES: Record<PremiumBenefitId, string> = {
  sync: 'Multi-Device Data Sync',
  forecasting: 'Advanced Forecasting — Raises, Rising Bills & One-Off Costs',
  profiles: 'Custom User Profiles',
  report: 'Downloadable Financial Summary Report',
  categories: 'Custom Categories & Category Breakdown',
}

const DEFAULT_MESSAGE =
  'This is a premium feature. Please upgrade to access advanced financial tools and insights.'

export function PremiumPrompt({
  featureName,
  message = DEFAULT_MESSAGE,
  asDialog = false,
  upgradeHref = '/login',
  onUpgradeClick,
  onClose,
}: PremiumPromptProps): React.ReactElement {
  const handleUpgradeClick = () => {
    // Navigation is the <Link>'s; this must not preventDefault, or the CTA never navigates.
    onUpgradeClick?.()
  }

  const handleClose = (e: React.MouseEvent) => {
    e.preventDefault()
    onClose?.()
  }

  if (asDialog) {
    return (
      <Modal
        isOpen
        onClose={() => onClose?.()}
        ariaLabel="Go Premium"
        // The wrapper is the scroll container, so a square clip box would crop the rounded card.
        className="relative w-full max-w-md rounded-xl"
      >
        <PremiumPromptContent
          featureName={featureName}
          message={message}
          upgradeHref={upgradeHref}
          onUpgradeClick={handleUpgradeClick}
          onClose={handleClose}
        />
      </Modal>
    )
  }

  return (
    <PremiumPromptContent
      featureName={featureName}
      message={message}
      upgradeHref={upgradeHref}
      onUpgradeClick={handleUpgradeClick}
      onClose={handleClose}
    />
  )
}

interface PremiumPromptContentProps {
  featureName?: string
  message: string
  upgradeHref: string
  onUpgradeClick: (e: React.MouseEvent) => void
  onClose: (e: React.MouseEvent) => void
}

function PremiumPromptContent({
  featureName,
  message,
  upgradeHref,
  onUpgradeClick,
  onClose,
}: PremiumPromptContentProps): React.ReactElement {
  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-800 rounded-xl shadow-lg border border-blue-200 dark:border-gray-700 p-6 max-w-md mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mr-3">
            <CrownIcon className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Go Premium</h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="mb-4">
        {featureName && (
          <p className="text-gray-700 dark:text-gray-300 mb-2">
            You need a premium subscription to access
            <span className="font-semibold text-blue-600 dark:text-blue-400 ml-1">
              "{featureName}"
            </span>
            .
          </p>
        )}
        {/* Own testid so a caller's message is asserted on its own element, not the benefit list. */}
        <p
          data-testid="premium-prompt-message"
          className="text-gray-600 dark:text-gray-400 text-sm"
        >
          {message}
        </p>
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          What you get:
        </h3>
        <ul className="space-y-2">
          {PREMIUM_BENEFIT_IDS.map((id) => PREMIUM_FEATURES[id]).map((feature) => (
            <li
              key={feature}
              className="flex items-center text-sm text-gray-600 dark:text-gray-400"
            >
              <CheckIcon className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
              {feature}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Link
          to={upgradeHref}
          className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 text-white font-medium rounded-lg shadow hover:bg-blue-700 transition-colors text-center"
          onClick={onUpgradeClick}
        >
          <SparklesIcon className="w-4 h-4 mr-2" />
          Upgrade to Premium
        </Link>
        <button
          type="button"
          onClick={onClose || (() => {})}
          className="inline-flex items-center justify-center px-4 py-2 bg-white text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600 transition-colors text-center"
          disabled={!onClose}
        >
          Maybe Later
        </button>
      </div>

      <p className="mt-4 text-xs text-center text-gray-400">All data stored in Germany (EU)</p>
    </div>
  )
}

function CrownIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 18V6a2 2 0 012-2h10a2 2 0 012 2v12M9 18h6M9 18h6M9 18V8m6 10V8m-6 10a2 2 0 002 2h2a2 2 0 002-2M9 18a2 2 0 00-2-2h2a2 2 0 002 2"
      />
    </svg>
  )
}

function CheckIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function CloseIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function SparklesIcon({ className }: { className: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      />
    </svg>
  )
}
