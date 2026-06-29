import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AdPlacement } from '../components/ads/AdPlacement'
import { Footer } from '../components/layout/Footer'
import { SyncProvider } from '../components/sync/SyncProvider'
import { MetadataProvider } from '../context/metadata-context'
import { StoreHydration } from '../lib/store-hydration'
import appCss from '../styles/global.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'Budget Planner' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
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
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <StoreHydration />
        {/* Mounts multi-device sync for authenticated paid sessions only
            (story 5-15): free/unauthenticated users get no service and no
            network. Renders nothing — pure wiring. */}
        <SyncProvider />
        {/* Captures privacy-respecting acquisition metadata from the landing
            URL (story 4-12): URL-only, in-memory, no cookies/localStorage. */}
        <MetadataProvider>
          {/* Column layout so the global Footer is pushed to the bottom of the
              viewport on short pages (mt-auto) yet flows after content on long ones. */}
          <div className="flex min-h-screen flex-col">
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
