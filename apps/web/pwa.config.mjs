// Shared PWA configuration (story 7-1). Single source of truth for the web app
// manifest and the Workbox options, imported by BOTH:
//   - vite.config.ts  → vite-plugin-pwa (emits the manifest + serves the dev SW)
//   - scripts/generate-sw.mjs → Workbox generateSW that emits the PRODUCTION
//                               dist/client/sw.js
//
// Why the split: under TanStack Start's multi-environment (client + ssr) Vite
// build, vite-plugin-pwa skips its own service-worker generation — its
// closeBundle step is gated on `!build.ssr` and never fires for the client
// output — so no production sw.js is emitted. We therefore run Workbox's own
// generateSW (the same engine the plugin wraps, NOT a hand-rolled SW) as a
// post-build step. Both paths share the options below so dev and prod behave
// identically. Everything is generated at build time and self-hosted from our
// own EU origin; no third-party/runtime PWA service is ever contacted
// (NFR1/NFR2 — zero US data residency).

/** @type {import('vite-plugin-pwa').ManifestOptions} */
export const pwaManifest = {
  name: 'Budget Planner',
  short_name: 'Budget Planner',
  description: 'Privacy-first budget & retirement planner.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: '#16a34a', // accent green — matches favicon + apple-touch (story 6-5)
  background_color: '#ffffff', // matches the app's light background (no dark mode until 7-3)
  icons: [
    { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

// Precache the hashed build assets (JS/CSS/fonts/icons/manifest). Workbox stamps
// each entry with a revision hash, so a new build invalidates the old precache
// and old caches are cleaned up on activate (AC-4 — no stale builds). There is no
// index.html to precache (the app is SSR), so the offline shell comes from the
// runtime navigation cache below, not from a precached document.
export const pwaGlobPatterns = ['**/*.{js,css,svg,png,ico,webmanifest,woff,woff2}']

// Runtime caching so the SSR app opens offline (AC-3). A same-origin NetworkFirst
// route caches the server-rendered app-shell document on the first online visit,
// then serves it from cache when the network is unavailable. `/api/*` server
// routes (sync, health, calc) are never cached — they must always hit the
// network. Same-origin only: no third-party/CDN caching (NFR1/NFR2).
export const pwaRuntimeCaching = [
  {
    urlPattern: ({ request, url }) =>
      request.mode === 'navigate' &&
      url.origin === self.location.origin &&
      // LOAD-BEARING: this predicate is the ONLY thing keeping `/api/*` out of the
      // offline app-shell cache. `pwaNavigateFallbackDenylist` below does NOT guard
      // this route — it only filters a `navigateFallback` precache route, which we
      // don't configure (SSR app, no index.html). Do not remove this line.
      !url.pathname.startsWith('/api/'),
    handler: 'NetworkFirst',
    options: {
      cacheName: 'app-shell',
      networkTimeoutSeconds: 3,
      expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 7 },
      cacheableResponse: { statuses: [200] },
    },
  },
]

// Reserved for a future `navigateFallback` precache route. NOTE: this is INERT
// today — Workbox only applies `navigateFallbackDenylist` to a `navigateFallback`
// route, and this SSR app configures none (no index.html to precache). The real
// `/api/*` protection is the `!url.pathname.startsWith('/api/')` predicate in
// `pwaRuntimeCaching` above. Kept so the denylist is already correct if a
// navigateFallback is ever added.
export const pwaNavigateFallbackDenylist = [/^\/api\//]
