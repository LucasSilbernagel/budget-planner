import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AdPlacement } from '../components/ads/AdPlacement'
import { AuthIndicator } from '../components/auth/auth-indicator'
import { Footer } from '../components/layout/Footer'
import { GlobalNav } from '../components/layout/GlobalNav'
import { RegisterSW } from '../components/pwa/RegisterSW'
import { SyncProvider } from '../components/sync/SyncProvider'
import { ThemeProvider } from '../components/theme/ThemeProvider'
import { MetadataProvider } from '../context/metadata-context'
import { buildAnalyticsScripts } from '../lib/analytics/counter'
import { StoreHydration } from '../lib/store-hydration'
import { THEME_STORAGE_KEY } from '../stores/themeStore'
import appCss from '../styles/global.css?url'

/**
 * No-flash theme bootstrap (story 7-3, AC-4). Runs synchronously in <head>
 * before first paint: reads the persisted theme from localStorage and adds the
 * `.dark` class to <html> so a paid user's dark preference paints correctly on
 * the very first frame — no flash of light before React hydrates. Wrapped in
 * try/catch so blocked or corrupt storage never throws (mirrors StoreHydration's
 * swallow-errors discipline). ThemeProvider reconciles + enforces the
 * premium-gate correction after mount.
 *
 * The storage key comes from `THEME_STORAGE_KEY` (single source of truth in
 * themeStore); the persisted `{ state: { theme } }` shape is still hard-parsed
 * here because this runs before any module can load. See that constant's JSDoc.
 */
const NO_FLASH_THEME_SCRIPT = `(function(){try{var raw=localStorage.getItem('${THEME_STORAGE_KEY}');if(!raw)return;var parsed=JSON.parse(raw);var theme=parsed&&parsed.state&&parsed.state.theme;if(theme==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`

export const Route = createRootRoute({
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
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
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
        {/* Syncs the persisted theme onto <html class="dark"> and enforces the
            premium fail-safe-to-light for non-paying users (story 7-3). Renders
            nothing. */}
        <ThemeProvider />
        {/* Registers the PWA service worker on the client (story 7-1): SSR-safe
            (dynamic import in an effect), renders nothing. */}
        <RegisterSW />
        {/* Mounts multi-device sync for authenticated paid sessions only
            (story 5-15): free/unauthenticated users get no service and no
            network. Renders nothing — pure wiring. */}
        <SyncProvider />
        {/* Captures privacy-respecting acquisition metadata from the landing
            URL (story 4-12): URL-only, in-memory, no cookies/localStorage. */}
        <MetadataProvider>
          {/* Column layout so the global Footer is pushed to the bottom of the
              viewport on short pages (mt-auto) yet flows after content on long ones.
              `pb-16 sm:pb-0` reserves space on narrow viewports for GlobalNav's
              fixed bottom tab bar (story 11-1) so it never covers the footer;
              desktop renders GlobalNav as a top bar and needs no padding. */}
          <div className="flex min-h-screen flex-col pb-16 sm:pb-0">
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
            {/* Global, unobtrusive ad slot. Renders only for non-premium users
                (story 4-11): unauthenticated/free see ads; active-premium do not. */}
            <AdPlacement />
            <Footer />
          </div>
        </MetadataProvider>
        <Scripts />
      </body>
    </html>
  )
}
