import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Footer } from '../components/layout/Footer'
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
        {/* Column layout so the global Footer is pushed to the bottom of the
            viewport on short pages (mt-auto) yet flows after content on long ones. */}
        <div className="flex min-h-screen flex-col">
          {children}
          <Footer />
        </div>
        <Scripts />
      </body>
    </html>
  )
}
