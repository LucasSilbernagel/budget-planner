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
      { title: 'Longhand Budget — the budget app that minds its own business' },
      // Privacy-first tagline (story 27-4, FR44 — amends story 25-4) for
      // social/search previews. The TITLE above carries the Longhand Budget
      // brand (story brand-1); the description below deliberately carries only
      // the tagline and no brand token, which is why the brand pin in
      // root-head.test.ts asserts against the title alone. This default title is
      // inherited by every route without its own head().
      {
        name: 'description',
        content:
          'The budget app that minds its own business. Track income, expenses, savings, and long-term plans — the free tier runs entirely in your browser, so your financial data never leaves your device.',
      },
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
              from covering the footer. Since story 31.5 the bar is a SINGLE-row
              5-column grid (four destinations + a "More" trigger) measuring
              56.75px at 320px — invariant across 320x568/320x720/360x640/390x844/
              412x915/639x720 and both themes — so the reserve is 3.75rem (60px,
              was 6rem/96px for the old two-row 4x2 bar) plus
              `env(safe-area-inset-bottom)` — the same inset the bar itself pads
              by, so the two stay in lockstep (0 on non-notched devices). Measured
              footer->nav gap at this value: 3.25px.
              ⚠️ This is a THREE-way coupling, and the third site is the one every
              prior story's comment forgot: `pwa/InstallPrompt.tsx`'s
              `bottom-[calc(3.75rem_+_env(safe-area-inset-bottom))]` must move with
              it. `pb-14` (3.5rem/56px) is NOT a valid substitute — the bar is
              56.75px, so 56px covers the footer by 0.75px.
              ⚠️ Too LARGE is a real defect too, and it used to be unguarded:
              leaving the 96px reserve against the 56.75px bar strands the footer
              above 39.25px of dead space while BOTH clearance guards pass more
              comfortably than before. `e2e/chrome-320.spec.ts` and
              `e2e/pwa-install.spec.ts` assert the gap two-sided now.
              ⚠️⚠️ THE RESERVE MUST BE MIXED rem+px, NOT PURE rem, AND CODE
              REVIEW CAUGHT WHY. The bar's height is `2.625rem + 14.75px`: the
              spacing tokens (`py-2` + `h-6` + `gap-0.5` = 2.625rem) scale with
              the root font, but the label's line box does NOT — `text-[11px]` is
              a fixed px size, giving a fixed 13.75px line plus the 1px border.
              A pure-rem `3.75rem` reserve therefore DRIFTS away from the bar as
              soon as the user changes their browser's default font size.
              Measured footer gap at the old pure-rem value: 12px root -> -1.25px
              (the fixed bar COVERS the footer), 16px -> 3.25px, 24px -> +12.25px
              of dead space. Both two-sided guards only ever measured at the
              default root size, so neither could see it. `2.625rem + 18px`
              mirrors the bar's own composition and holds the gap at a constant
              3.25px at EVERY root font size — and is identical to the old value
              at the 16px default.
              Desktop renders GlobalNav as a top bar and needs no padding. */}
            <div className="flex min-h-screen flex-col pb-[calc(2.625rem_+_18px_+_env(safe-area-inset-bottom))] sm:pb-0">
              {/* Desktop (≥640px): the primary nav and the account/sign-in
                indicator share ONE bar — nav links leading (left), the indicator
                trailing (right-aligned) — so the top of the app reads as a single
                navigation row instead of two stacked strips (story 19-3). The
                outer wrapper owns the shared bar chrome (border + background) at
                `sm:`; the inner wrapper centres the row on the app's `max-w-6xl`
                content column. Below `sm:` both wrappers are inert (their utility
                classes are all `sm:`-gated): GlobalNav renders its fixed BOTTOM
                tab bar (out of flow) and AuthIndicator renders as a full-width top
                strip, each carrying its own chrome via `max-sm:`, so the indicator
                is never crowded into the 320px bottom bar (story 13-2 rationale). */}
              {/* `data-print-hide` (story 30-3): app chrome must not reach paper
                  when a page is printed. Marking this one wrapper covers the
                  whole header row — GlobalNav (desktop top bar AND the fixed
                  mobile tab bar, which is a DOM descendant even though it is out
                  of flow) plus AuthIndicator — so the print stylesheet needs a
                  single inert hook rather than a list of chrome selectors. Inert
                  outside `@media print`; see `styles/global.css`. */}
              <div
                data-print-hide
                className="sm:border-b sm:border-gray-200 sm:bg-white dark:sm:border-gray-700 dark:sm:bg-gray-800"
              >
                <div className="sm:mx-auto sm:flex sm:max-w-6xl sm:items-center sm:justify-between">
                  {/* Persistent primary navigation (story 11-1): rendered once here
                    so every route shares it. Leading (left) on the desktop row; a
                    fixed bottom tab bar on narrow/PWA viewports. */}
                  <GlobalNav />
                  {/* Persistent signed-in / Premium indicator (story 13-2):
                    trailing (right) on the desktop row so a signed-in user always
                    sees they are logged in (with a Premium marker when active)
                    without opening Settings; a slim top strip on narrow viewports.
                    Fetch-based + SSR-safe; kept out of GlobalNav so the 320px
                    mobile tab bar is not crowded. */}
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
