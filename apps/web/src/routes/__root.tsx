import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AuthIndicator } from '../components/auth/auth-indicator'
import { Footer } from '../components/layout/Footer'
import { GlobalNav } from '../components/layout/GlobalNav'
import { InstallPrompt } from '../components/pwa/InstallPrompt'
import { RegisterSW } from '../components/pwa/RegisterSW'
import { SyncProvider } from '../components/sync/SyncProvider'
import { ThemeProvider } from '../components/theme/ThemeProvider'
import { MetadataProvider } from '../context/metadata-context'
import { type SessionSeed, SessionSeedProvider } from '../context/session-seed'
import { buildAnalyticsScripts } from '../lib/analytics/counter'
import { StoreHydration } from '../lib/store-hydration'
// Single source of truth for the inline no-flash theme bootstrap. Shared with
// the CSP builder (server/middleware/security-headers.ts), which hashes this
// exact string to pin the `script-src` — keep it imported, never re-inline it
// here (a divergent copy would silently break the strict CSP; story sec-1).
import { NO_FLASH_THEME_SCRIPT } from '../lib/theme/no-flash-theme-script'
import { getSessionSeed } from '../server/api/auth/session-seed'
import appCss from '../styles/global.css?url'

export const Route = createRootRoute({
  // Resolve the session ONCE, server-side, so the first painted frame is already
  // correct for the auth strip and the premium feature gates (story UX-1, AC-1).
  // `getSessionSeed` is a server function: during SSR it runs in-process and its
  // result hydrates to the client; the descendant components consume it as an
  // initial value. `staleTime: Infinity` keeps the seed from being re-fetched
  // (no RPC) on client-side navigations — the auth strip owns per-navigation
  // freshness via its own /api/auth/me refetch (AC-4), and the premium seed is
  // read once at first paint. The server-only resolver never reaches the client
  // bundle (AC-5) — see server/api/auth/session-seed.
  loader: () => getSessionSeed(),
  staleTime: Number.POSITIVE_INFINITY,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'Budget Planner' },
      // Drives the standalone titlebar color when installed as a PWA (story 7-1,
      // AC-2). Matches the manifest theme_color and the accent green.
      { name: 'theme-color', content: '#16a34a' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      // Favicon set (story 6-5). Modern browsers pick the SVG; the .ico is the
      // legacy fallback and the sized PNGs cover browsers that ignore SVG icons.
      // The 512 maskable PNG is intentionally NOT linked here — it is consumed by
      // the PWA manifest (story 7-1) as a maskable icon, never as a favicon.
      { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16.png' },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
      { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      // PWA web app manifest (story 7-1). Served self-hosted from our own EU
      // origin; makes the app installable + drives standalone launch.
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
    // Cookieless counter.dev analytics (story 10-1, FR28). Emitted here as a
    // real SSR <script data-id> by <Scripts /> so counter.dev's
    // `document.currentScript` data-id read works (a DOM-injected tag would be
    // read as null). Omitted entirely when VITE_COUNTERDEV_ID is unset. See
    // lib/analytics/counter.ts + ADR-005.
    scripts: buildAnalyticsScripts(),
  }),
  component: RootComponent,
})

function RootComponent() {
  // The session resolved once server-side by the root loader (story UX-1). Passed
  // down so the auth strip + premium gates paint their resolved state on the
  // first frame. `null` when the resolver could not verify the session — see
  // `getSessionSeed`; consumers then fall back to their own client check.
  const seed = Route.useLoaderData()
  return (
    <RootDocument seed={seed}>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children, seed }: { children: ReactNode; seed: SessionSeed | null }) {
  return (
    // suppressHydrationWarning: the no-flash script mutates <html>'s className
    // before hydration (adds `.dark`), which the server HTML does not carry.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking, self-authored bootstrap — must run before the stylesheet
            paints to prevent a theme flash (story 7-3, AC-4). */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static inline bootstrap with no user input; must execute before React hydration. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <StoreHydration />
        {/* The session resolved once server-side by the root loader (story UX-1),
            provided as an initial seed so the auth strip (below) and every
            usePremiumAccess consumer (the premium feature gates) paint their
            resolved state on the first frame instead of a placeholder that flips
            after a client round-trip. */}
        <SessionSeedProvider seed={seed}>
          {/* Syncs the persisted theme onto <html class="dark"> (story 7-3;
              dark mode moved to Free in story 25-3, so no tier fail-safe).
              Renders nothing. */}
          <ThemeProvider />
          {/* Registers the PWA service worker on the client (story 7-1): SSR-safe
            (dynamic import in an effect), renders nothing. */}
          <RegisterSW />
          {/* Unobtrusive PWA install affordance (story 17-1): client-only + SSR-safe,
            renders nothing until the browser fires `beforeinstallprompt`, and
            self-suppresses when already installed or recently dismissed. */}
          <InstallPrompt />
          {/* Mounts multi-device sync for authenticated paid sessions only
            (story 5-15): free/unauthenticated users get no service and no
            network. Renders nothing — pure wiring. */}
          <SyncProvider />
          {/* Captures privacy-respecting acquisition metadata from the landing
            URL (story 4-12): URL-only, in-memory, no cookies/localStorage. */}
          <MetadataProvider>
            {/* Column layout so the global Footer is pushed to the bottom of the
              viewport on short pages (mt-auto) yet flows after content on long ones.
              The narrow reserve keeps GlobalNav's fixed bottom tab bar (story 11-1)
              from covering the footer; the bar is a two-row 4-column grid (~89px at
              320px, story 18-2), so the reserve is 6rem (96px, was `pb-16`/64px)
              plus `env(safe-area-inset-bottom)` — the same inset the bar itself
              pads by, so the two stay in lockstep (0 on non-notched devices).
              Desktop renders GlobalNav as a top bar and needs no padding. */}
            <div className="flex min-h-screen flex-col pb-[calc(6rem_+_env(safe-area-inset-bottom))] sm:pb-0">
              {/* Persistent signed-in / Premium indicator (story 13-2): a slim top
                strip above the nav, on every viewport, so a signed-in user always
                sees they are logged in (with a Premium marker when active) without
                opening Settings. Fetch-based + SSR-safe; kept out of GlobalNav so
                the 320px mobile tab bar is not crowded. */}
              <AuthIndicator />
              {/* Persistent primary navigation (story 11-1): rendered once here so
                every route shares it. Top bar on desktop, fixed bottom tab bar on
                narrow/PWA viewports. */}
              <GlobalNav />
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
