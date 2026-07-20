/**
 * Premium Prompt Component
 *
 * Displays an upgrade prompt for users attempting to access premium features.
 * Shows the value proposition and provides a call-to-action to upgrade.
 *
 * Architecture: React Component with Tailwind CSS
 * Usage: Shown when non-premium users try to access premium features
 */

import { Link } from '@tanstack/react-router'
import React from 'react'
import { Modal } from '../ui/Modal'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for PremiumPrompt component
 */
export interface PremiumPromptProps {
  /** The premium feature name the user is trying to access */
  featureName?: string
  /** Custom message to display */
  message?: string
  /** Whether to show as a dialog/modal */
  asDialog?: boolean
  /**
   * Where the upgrade call-to-action links. Defaults to `/login` (the shipped
   * behavior). Story 7-2 passes `/pricing` from `PremiumFeatureGate` so the
   * locked-feature CTA leads to the public value/pricing page (DECISION 2).
   */
  upgradeHref?: string
  /** Callback when user clicks upgrade */
  onUpgradeClick?: () => void
  /** Callback when user clicks close/dismiss */
  onClose?: () => void
}

// ============================================================================
// Constants
// ============================================================================

// The canonical Premium benefit set — exactly these three, matched across every
// surface that advertises Premium (HomePage, Features, Pricing) per Epic 20 /
// Story 25.3. Keep to benefits the app actually delivers (Story 13.1); no
// overpromises and no "coming soon" padding. Scenario modeling and saved
// forecasts are folded into "Advanced Forecasting". Dark mode is NOT here — it
// is a free feature for all users (Story 25.3); ad-freeness is universal, not a
// perk (Story 25.1).
const PREMIUM_FEATURES = [
  'Multi-Device Data Sync',
  'Custom User Profiles',
  'Advanced Forecasting & Scenario Modeling',
]

const DEFAULT_MESSAGE =
  'This is a premium feature. Please upgrade to access advanced financial tools and insights.'

// ============================================================================
// Main Component
// ============================================================================

/**
 * Premium Prompt Component
 *
 * Displays information about premium features and prompts user to upgrade.
 *
 * @param props - Component props
 * @returns JSX Element
 *
 * @example
 * ```tsx
 * <PremiumPrompt featureName="Advanced Forecasting" />
 *
 * // As a dialog
 * <PremiumPrompt asDialog onClose={() => setShowPrompt(false)} />
 * ```
 */
export function PremiumPrompt({
  featureName,
  message = DEFAULT_MESSAGE,
  asDialog = false,
  upgradeHref = '/login',
  onUpgradeClick,
  onClose,
}: PremiumPromptProps): React.ReactElement {
  const handleUpgradeClick = () => {
    // Navigation to `upgradeHref` is handled natively by the <Link>. This hook
    // stays so callers can run side effects (e.g. analytics) on upgrade; it must
    // NOT preventDefault, or the CTA would never navigate.
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
        className="relative w-full max-w-md"
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

// ============================================================================
// Content Component
// ============================================================================

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
      {/* Header */}
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

      {/* Message */}
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
        <p className="text-gray-600 dark:text-gray-400 text-sm">{message}</p>
      </div>

      {/* Features List */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
          What you get:
        </h3>
        <ul className="space-y-2">
          {PREMIUM_FEATURES.map((feature) => (
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

      {/* CTA Button */}
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

      {/* Footer */}
      <p className="mt-4 text-xs text-center text-gray-400">
        All data stored in Germany (EU) • CLOUD Act compliant
      </p>
    </div>
  )
}

// ============================================================================
// Icon Components
// ============================================================================

/**
 * Crown Icon - Represents premium features
 */
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

/**
 * Check Icon - For feature list items
 */
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

/**
 * Close Icon - For dialog close button
 */
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

/**
 * Sparkles Icon - For upgrade button
 */
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
