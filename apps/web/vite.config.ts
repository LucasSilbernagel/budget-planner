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

const { version: appVersion } = JSON.parse(
  readFileSync(resolve(__dirname, './package.json'), 'utf-8')
) as { version: string }

// The Start plugin MUST be registered before the React plugin.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    tanstackStart({
      router: { routeFileIgnorePattern: '(__tests__|\\.(test|spec)\\.)' },
    }),
    viteReact(),
    // MUST be the LAST plugin. It emits only the manifest and dev SW: the production SW is
    // generated post-build because Start's multi-environment build gates out generateSW.
    VitePWA({
      registerType: 'autoUpdate',
      // No index.html (the head is built in __root), so the plugin's HTML injection is disabled.
      injectRegister: false,
      strategies: 'generateSW',
      manifestFilename: 'manifest.webmanifest',
      workbox: {
        globPatterns: pwaGlobPatterns,
        runtimeCaching: pwaRuntimeCaching,
        navigateFallbackDenylist: pwaNavigateFallbackDenylist,
      },
      manifest: pwaManifest,
      // suppressWarnings: the dev SW otherwise globs `dev-dist/` with the production patterns and
      // warns every run. Don't narrow `pwaGlobPatterns` instead: the production SW needs them.
      devOptions: { enabled: true, type: 'module', suppressWarnings: true },
    }),
  ],
  // Reached only at runtime, so the start-up scan missed it and optimizing it later
  // full-reloaded every open page mid-test.
  optimizeDeps: { include: ['workbox-window'] },
  resolve: {
    // Array form so order is deterministic: more-specific `find`s must precede
    // less-specific ones (rollup/plugin-alias uses the first match).
    alias: [
      // `pg-native` is an optional peer we never install; Vite resolves it to a module that throws
      // at evaluation, crashing the whole server graph.
      { find: /^pg-native$/, replacement: resolve(__dirname, './pg-native-stub.mjs') },
      { find: '@budget-planner/core', replacement: resolve(__dirname, '../../packages/core/src') },
      {
        find: '@budget-planner/config',
        replacement: resolve(__dirname, '../../packages/config/src'),
      },
      // Must precede the bare `@budget-planner/db` rule, or it rewrites to `packages/db/src/src/schema`.
      { find: '@budget-planner/db/src', replacement: resolve(__dirname, '../../packages/db/src') },
      { find: '@budget-planner/db', replacement: resolve(__dirname, '../../packages/db/src') },
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  },
  server: {
    fs: {
      allow: [resolve(__dirname, '../../')],
    },
  },
})
