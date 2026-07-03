// Generates the production service worker (story 7-1) with Workbox's own
// `generateSW` — the same engine vite-plugin-pwa wraps, NOT a hand-rolled SW.
//
// Why this is a separate post-build step: under TanStack Start's multi-
// environment (client + ssr) Vite build, vite-plugin-pwa's service-worker
// generation is gated on `!build.ssr` and never fires for the client output, so
// no production sw.js is emitted (only the manifest + register bundle are). We
// run generateSW ourselves against dist/client, sharing the exact Workbox
// options from pwa.config.mjs so dev and prod behave identically.
//
// Data sovereignty: runs at build time and writes a static, self-hosted sw.js —
// no third-party/runtime service is contacted (NFR1/NFR2, zero US residency).

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSW } from 'workbox-build'
import { pwaGlobPatterns, pwaNavigateFallbackDenylist, pwaRuntimeCaching } from '../pwa.config.mjs'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(webRoot, 'dist', 'client')

const { count, size, warnings } = await generateSW({
  globDirectory: clientDir,
  globPatterns: pwaGlobPatterns,
  swDest: join(clientDir, 'sw.js'),
  // Take over open pages immediately on activate so a redeploy is never stale
  // (AC-4); pairs with registerType: 'autoUpdate' on the client.
  clientsClaim: true,
  skipWaiting: true,
  // Drop precaches from previous builds on activate (AC-4).
  cleanupOutdatedCaches: true,
  // Serve the SSR app-shell document from a same-origin runtime cache so the app
  // opens offline (AC-3). There is no index.html to precache, so no
  // navigateFallback — the runtime NetworkFirst route below is the offline shell.
  runtimeCaching: pwaRuntimeCaching,
  navigateFallbackDenylist: pwaNavigateFallbackDenylist,
})

for (const warning of warnings) {
  process.stdout.write(`[generate-sw] warning: ${warning}\n`)
}

// A zero-file precache means dist/client is missing/empty or the glob matched
// nothing (e.g. Vite output-layout drift). Workbox still writes a "successful"
// sw.js and exits 0, which would silently ship a broken offline shell. Fail the
// build instead so the regression is caught (AC-3/AC-4).
if (count === 0) {
  process.stderr.write(
    '[generate-sw] ERROR: precached 0 files — dist/client is missing/empty or the glob matched ' +
      'nothing. Refusing to emit an empty service worker (the offline shell would be broken). ' +
      'Ensure `vite build` ran first and emitted dist/client.\n'
  )
  process.exit(1)
}

process.stdout.write(
  `[generate-sw] precached ${count} files, ${(size / 1024).toFixed(1)} KiB → dist/client/sw.js\n`
)
