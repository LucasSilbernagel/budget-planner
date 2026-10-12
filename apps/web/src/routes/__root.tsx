import { createRootRoute, Outlet } from '@tanstack/react-router'
import { RootDocument } from '../components/layout/RootDocument'
import { buildAnalyticsScripts } from '../lib/analytics/counter'
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
