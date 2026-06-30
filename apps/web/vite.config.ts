import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
