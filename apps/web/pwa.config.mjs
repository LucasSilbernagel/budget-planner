// Shared by vite-plugin-pwa (dev) and the post-build Workbox generateSW step: under
// TanStack Start's multi-environment build the plugin never emits a production sw.js.

/** @type {Partial<import('vite-plugin-pwa').ManifestOptions>} */
export const pwaManifest = {
	// `short_name` is coupled to InstallPrompt's "Install <short_name>" copy.
	name: 'Longhand Budget',
	short_name: 'Longhand',
	description: 'Longhand Budget — privacy-first budget & retirement planner.',
	start_url: '/',
	scope: '/',
	display: 'standalone',
	theme_color: '#16a34a',
	// A manifest background_color can't be media-keyed, so dark-preference devices get a
	// white install splash before the app paints.
	background_color: '#ffffff',
	icons: [
		{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
		{ src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
		{ src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
	],
}

// No index.html to precache (SSR), so the offline shell comes from the runtime
// navigation cache below.
export const pwaGlobPatterns = ['**/*.{js,css,svg,png,ico,webmanifest,woff,woff2}']

// Cache used only when the network request fails. Deliberately no networkTimeoutSeconds:
// a timeout fallback could serve another session's cached document.
/** @type {import('workbox-build').RuntimeCaching[]} */
export const pwaRuntimeCaching = [
	{
		urlPattern: ({ request, url }) =>
			request.mode === 'navigate' &&
			url.origin === self.location.origin &&
			// The only thing keeping /api/* out of the app-shell cache: the fallback denylist
			// below doesn't guard this route.
			!url.pathname.startsWith('/api/'),
		handler: 'NetworkFirst',
		options: {
			cacheName: 'app-shell',
			expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
			cacheableResponse: { statuses: [200] },
		},
	},
]

// Inert today: Workbox applies it only to a navigateFallback route, which this SSR
// app doesn't configure. Kept correct in case one is added.
export const pwaNavigateFallbackDenylist = [/^\/api\//]
