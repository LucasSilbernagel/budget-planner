import { HeadContent, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { MetadataProvider } from '../../context/metadata-provider'
import type { SessionSeed } from '../../context/session-seed'
import { SessionSeedProvider } from '../../context/session-seed-provider'
// The CSP hashes these exact strings: keep them imported, never re-inline a copy.
import { NO_FLASH_PLANNER_SCRIPT } from '../../lib/nav/no-flash-planner-visibility-script'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../../lib/overview/no-flash-account-notice-script'
import { NO_FLASH_OVERVIEW_DATA_SCRIPT } from '../../lib/overview/no-flash-overview-data-script'
import { StoreHydration } from '../../lib/store-hydration'
import { AuthIndicator } from '../auth/auth-indicator'
import { PlannerVisibilityProvider } from '../nav/PlannerVisibilityProvider'
import { InstallPrompt } from '../pwa/InstallPrompt'
import { RegisterSW } from '../pwa/RegisterSW'
import { SyncProvider } from '../sync/SyncProvider'
import { Footer } from './Footer'
import { GlobalNav } from './GlobalNav'

export function RootDocument({
	children,
	seed,
}: {
	children: ReactNode
	seed: SessionSeed | null
}) {
	return (
		// suppressHydrationWarning: the no-flash scripts add data-* attributes to <html> before hydration.
		<html lang="en" suppressHydrationWarning>
			<head>
				{/* Must run before first paint; the CSP allows each by the sha256 hash of its imported
            constant. They cover state the server cannot know (localStorage, skipHydration stores). */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static inline bootstrap with no user input; must execute before React hydration. */}
				<script dangerouslySetInnerHTML={{ __html: NO_FLASH_PLANNER_SCRIPT }} />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static inline bootstrap with no user input; must execute before React hydration. */}
				<script dangerouslySetInnerHTML={{ __html: NO_FLASH_ACCOUNT_NOTICE_SCRIPT }} />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static inline bootstrap with no user input; must execute before React hydration. */}
				<script dangerouslySetInnerHTML={{ __html: NO_FLASH_OVERVIEW_DATA_SCRIPT }} />
				<HeadContent />
			</head>
			<body suppressHydrationWarning>
				<StoreHydration seed={seed} />
				<SessionSeedProvider seed={seed}>
					{/* Required: the <head> bootstrap only sets the attribute; this keeps it in sync after. */}
					<PlannerVisibilityProvider />
					<RegisterSW />
					<InstallPrompt />
					<SyncProvider />
					<MetadataProvider>
						{/* Reserve mirrors the bar's mixed rem+px height so the gap holds at any root font size;
                InstallPrompt's bottom offset must move with it. */}
						<div className="flex min-h-screen flex-col pb-[calc(2.625rem_+_18px_+_env(safe-area-inset-bottom))] sm:pb-0">
							<div
								data-print-hide
								className="sm:border-b sm:border-gray-200 sm:bg-white dark:sm:border-gray-700 dark:sm:bg-gray-800"
							>
								<div className="sm:mx-auto sm:flex sm:max-w-6xl sm:flex-wrap sm:items-center sm:justify-between">
									<GlobalNav />
									<AuthIndicator />
								</div>
							</div>
							{children}
							<Footer />
						</div>
					</MetadataProvider>
				</SessionSeedProvider>
				<Scripts />
			</body>
		</html>
	)
}
