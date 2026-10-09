import type React from 'react'
import { Modal } from '../ui/Modal'
import { PremiumPromptContent } from './premium-prompt-content'

export type PremiumPromptProps = {
	featureName?: string
	message?: string
	asDialog?: boolean
	upgradeHref?: string
	onUpgradeClick?: () => void
	onClose?: () => void
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
