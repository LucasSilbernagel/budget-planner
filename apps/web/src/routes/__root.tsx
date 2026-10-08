import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AuthIndicator } from '../components/auth/auth-indicator'
import { Footer } from '../components/layout/Footer'
import { GlobalNav } from '../components/layout/GlobalNav'
import { PlannerVisibilityProvider } from '../components/nav/PlannerVisibilityProvider'
import { InstallPrompt } from '../components/pwa/InstallPrompt'
import { RegisterSW } from '../components/pwa/RegisterSW'
import { SyncProvider } from '../components/sync/SyncProvider'
import { MetadataProvider } from '../context/metadata-context'
import { type SessionSeed, SessionSeedProvider } from '../context/session-seed'
import { buildAnalyticsScripts } from '../lib/analytics/counter'
// The CSP hashes these exact strings: keep them imported, never re-inline a copy.
import { NO_FLASH_PLANNER_SCRIPT } from '../lib/nav/no-flash-planner-visibility-script'
import { NO_FLASH_ACCOUNT_NOTICE_SCRIPT } from '../lib/overview/no-flash-account-notice-script'
import { NO_FLASH_OVERVIEW_DATA_SCRIPT } from '../lib/overview/no-flash-overview-data-script'
import { StoreHydration } from '../lib/store-hydration'
import { getSessionSeed } from '../server/api/auth/session-seed'
import appCss from '../styles/global.css?url'

export const Route = createRootRoute({
	// staleTime: Infinity: the seed is read once at first paint; the auth strip refetches itself.
	loader: () => getSessionSeed(),
	staleTime: Number.POSITIVE_INFINITY,
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
			{ title: 'Longhand Budget — track your finances with privacy and control' },
			{
				name: 'description',
				content:
					'Track your finances with privacy and control — income, expenses, savings, and long-term plans. The free tier runs entirely in your browser, so your financial data never leaves your device.',
			},
			{ name: 'theme-color', content: '#16a34a' },
			// Absolute URL: social scrapers don't reliably resolve a relative og:image.
			{ property: 'og:type', content: 'website' },
			{ property: 'og:site_name', content: 'Longhand Budget' },
			// Deliberately shorter than <title>/description: trimmed to social-preview truncation limits.
			{
				property: 'og:title',
				content: 'Longhand Budget — private budgeting, no bank sync',
			},
			{
				property: 'og:description',
				content:
					'Track income, expenses, and savings in your browser — no bank sync, no account required, your data stays on your device.',
			},
			{ property: 'og:image', content: 'https://www.longhandbudget.com/og-image.png' },
			{ property: 'og:image:width', content: '1200' },
			{ property: 'og:image:height', content: '630' },
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:image', content: 'https://www.longhandbudget.com/og-image.png' },
		],
		links: [
			{ rel: 'stylesheet', href: appCss },
			// The 512 maskable PNG belongs to the manifest only, never a favicon.
			{ rel: 'icon', href: '/favicon.ico', sizes: 'any' },
			{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
			{ rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
			{ rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
			{ rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
			{ rel: 'manifest', href: '/manifest.webmanifest' },
		],
		// Must be a real SSR <script> so counter.dev's document.currentScript data-id read works.
		scripts: buildAnalyticsScripts(),
	}),
	component: RootComponent,
})

function RootComponent() {
	const seed = Route.useLoaderData()
	return (
		<RootDocument seed={seed}>
			<Outlet />
		</RootDocument>
	)
}

function RootDocument({ children, seed }: { children: ReactNode; seed: SessionSeed | null }) {
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
