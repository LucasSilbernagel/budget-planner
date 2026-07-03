import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import {
  pwaGlobPatterns,
  pwaManifest,
  pwaNavigateFallbackDenylist,
  pwaRuntimeCaching,
} from './pwa.config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Read the app version from package.json at config-evaluation time and inline it
// into the bundle as `__APP_VERSION__` (story 4-8, AC-1). Reading from disk (vs.
// a static import) keeps package.json the single source of truth: bumping the
// version there is all that's needed for the footer to update on deploy.
const { version: appVersion } = JSON.parse(
  readFileSync(resolve(__dirname, './package.json'), 'utf-8')
) as { version: string }

// https://tanstack.com/start — the Start plugin owns SSR, the server runtime,
// and file-based route generation. It MUST be registered before the React plugin.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    tanstackStart({
      // Co-located test files (e.g. routes/api/.../__tests__/*.test.ts) are not
      // routes; keep the generator from treating them as such and warning.
      router: { routeFileIgnorePattern: '(__tests__|\\.(test|spec)\\.)' },
    }),
    viteReact(),
    // Progressive Web App support (story 7-1). MUST be the LAST plugin so it sees
    // the finished client graph. Here the plugin emits the web app manifest and
    // serves the DEV service worker (devOptions); the PRODUCTION sw.js is emitted
    // by scripts/generate-sw.mjs post-build, because under TanStack Start's
    // multi-environment build the plugin's own generateSW step is gated out (see
    // pwa.config.mjs). Both use the shared Workbox options so dev/prod match.
    // The plugin is a DEV-ONLY dependency and everything it produces is static
    // and self-hosted — no runtime third-party/US service, so NFR1/NFR2 hold.
    VitePWA({
      // A new build's service worker takes over automatically (skipWaiting +
      // clientsClaim are implied by autoUpdate), so users never see a stale build
      // and no manual "reload to update" prompt is needed (AC-4).
      registerType: 'autoUpdate',
      // This app has NO index.html — the document head is built from
      // src/routes/__root.tsx. The plugin's default HTML injection has nothing to
      // inject into, so disable it: the manifest <link> + theme-color <meta> are
      // added manually in __root.tsx and the SW is registered via
      // `virtual:pwa-register` in components/pwa/RegisterSW.tsx.
      injectRegister: false,
      strategies: 'generateSW',
      manifestFilename: 'manifest.webmanifest',
      workbox: {
        globPatterns: pwaGlobPatterns,
        runtimeCaching: pwaRuntimeCaching,
        navigateFallbackDenylist: pwaNavigateFallbackDenylist,
      },
      manifest: pwaManifest,
      // Emit the manifest + a dev SW under the Vite dev server too — Playwright
      // boots `pnpm dev`, so without this the registration/manifest e2e would
      // have nothing to assert against. Genuine offline/precache behavior only
      // exists in a real build (see e2e/pwa.spec.ts offline note).
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  resolve: {
    // Array form so order is deterministic: more-specific `find`s must precede
    // less-specific ones (rollup/plugin-alias uses the first match).
    alias: [
      // `pg` (via @budget-planner/db → drizzle node-postgres) declares `pg-native`
      // as an OPTIONAL peer dep. We never use the native driver and it is not
      // installed; left alone, Vite resolves it to a module whose body throws at
      // evaluation time, which crashes the eagerly-loaded server graph on EVERY
      // request — SSR, /api/*, health (Story 5-2, AC-1). Alias it to a benign
      // empty module so the never-taken native path no longer throws. Exact-match
      // regex so it cannot catch unrelated specifiers.
      { find: /^pg-native$/, replacement: resolve(__dirname, './pg-native-stub.mjs') },
      // Path aliases for monorepo packages
      { find: '@budget-planner/core', replacement: resolve(__dirname, '../../packages/core/src') },
      {
        find: '@budget-planner/config',
        replacement: resolve(__dirname, '../../packages/config/src'),
      },
      // Several server modules import the schema via the package subpath
      // `@budget-planner/db/src/schema` (valid under tsc/node resolution). This
      // more-specific rule must come BEFORE the bare `@budget-planner/db` rule,
      // otherwise the bare alias rewrites it to `packages/db/src/src/schema`.
      { find: '@budget-planner/db/src', replacement: resolve(__dirname, '../../packages/db/src') },
      { find: '@budget-planner/db', replacement: resolve(__dirname, '../../packages/db/src') },
      // Path alias for project-relative imports
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  },
  server: {
    fs: {
      // Allow serving files from the monorepo root (workspace packages)
      allow: [resolve(__dirname, '../../')],
    },
  },
})
